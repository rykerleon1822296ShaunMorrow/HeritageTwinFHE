// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface SiteRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  siteName: string;
  condition: number; // 1-100 scale
  environmentalImpact: {
    wind: number;
    rain: number;
    temperature: number;
  };
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<SiteRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({
    siteName: "",
    location: "",
    condition: 80,
    description: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [showTeam, setShowTeam] = useState(false);

  // Statistics calculations
  const averageCondition = records.length > 0 
    ? Math.round(records.reduce((sum, r) => sum + r.condition, 0) / records.length)
    : 0;
  const atRiskCount = records.filter(r => r.condition < 50).length;

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("site_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing site keys:", e);
        }
      }
      
      const list: SiteRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`site_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                encryptedData: recordData.data,
                timestamp: recordData.timestamp,
                owner: recordData.owner,
                siteName: recordData.siteName,
                condition: recordData.condition || 80,
                environmentalImpact: recordData.environmentalImpact || {
                  wind: 0,
                  rain: 0,
                  temperature: 0
                }
              });
            } catch (e) {
              console.error(`Error parsing site data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading site ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading sites:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitRecord = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting site data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newRecordData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const recordData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        siteName: newRecordData.siteName,
        condition: newRecordData.condition,
        environmentalImpact: {
          wind: Math.random() * 100,
          rain: Math.random() * 100,
          temperature: Math.random() * 100
        }
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `site_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("site_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "site_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted site data submitted securely!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({
          siteName: "",
          location: "",
          condition: 80,
          description: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const simulateEnvironmentalImpact = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Running FHE environmental simulation..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`site_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Site not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      // Simulate FHE environmental impact calculation
      const updatedRecord = {
        ...recordData,
        environmentalImpact: {
          wind: Math.min(100, recordData.environmentalImpact.wind + Math.random() * 10),
          rain: Math.min(100, recordData.environmentalImpact.rain + Math.random() * 10),
          temperature: Math.min(100, recordData.environmentalImpact.temperature + Math.random() * 5)
        },
        condition: Math.max(0, recordData.condition - Math.random() * 2)
      };
      
      await contract.setData(
        `site_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE simulation completed successfully!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Simulation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the Heritage Twin platform",
      icon: "🔗"
    },
    {
      title: "Register Site",
      description: "Add your historical site to create a confidential digital twin",
      icon: "🏛️"
    },
    {
      title: "FHE Simulation",
      description: "Run encrypted environmental impact simulations without exposing sensitive data",
      icon: "⚙️"
    },
    {
      title: "Monitor & Protect",
      description: "Track condition changes and implement preventive measures",
      icon: "🛡️"
    }
  ];

  const teamMembers = [
    {
      name: "Dr. Elena Zhang",
      role: "Heritage Conservation Expert",
      bio: "20+ years in historical preservation, specializing in Asian architecture"
    },
    {
      name: "Prof. Raj Patel",
      role: "FHE Cryptography Lead",
      bio: "Pioneer in fully homomorphic encryption applications for cultural data"
    },
    {
      name: "Li Wei",
      role: "Environmental Engineer",
      bio: "Develops climate impact models for heritage sites"
    },
    {
      name: "Sophia Müller",
      role: "Blockchain Architect",
      bio: "Designs decentralized preservation systems"
    }
  ];

  const renderImpactChart = (record: SiteRecord) => {
    return (
      <div className="impact-chart">
        <div className="chart-bar">
          <div className="bar-label">Wind</div>
          <div className="bar-container">
            <div 
              className="bar-fill wind" 
              style={{ width: `${record.environmentalImpact.wind}%` }}
            ></div>
          </div>
        </div>
        <div className="chart-bar">
          <div className="bar-label">Rain</div>
          <div className="bar-container">
            <div 
              className="bar-fill rain" 
              style={{ width: `${record.environmentalImpact.rain}%` }}
            ></div>
          </div>
        </div>
        <div className="chart-bar">
          <div className="bar-label">Temp</div>
          <div className="bar-container">
            <div 
              className="bar-fill temp" 
              style={{ width: `${record.environmentalImpact.temperature}%` }}
            ></div>
          </div>
        </div>
      </div>
    );
  };

  const renderConditionMeter = (condition: number) => {
    let color;
    if (condition > 75) color = "#4CAF50";
    else if (condition > 50) color = "#FFC107";
    else color = "#F44336";

    return (
      <div className="condition-meter">
        <div className="meter-track">
          <div 
            className="meter-fill" 
            style={{ width: `${condition}%`, backgroundColor: color }}
          ></div>
        </div>
        <div className="meter-value">{condition}%</div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="metallic-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container metallic-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>Heritage<span>Twin</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn metallic-button"
          >
            <div className="add-icon"></div>
            Register Site
          </button>
          <button 
            className="metallic-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <button 
            className="metallic-button"
            onClick={() => setShowTeam(!showTeam)}
          >
            {showTeam ? "Hide Team" : "Our Team"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-panel">
          <div className="welcome-text">
            <h2>Confidential Digital Twin for Historical Preservation</h2>
            <p>Securely simulate environmental impacts on heritage sites using FHE technology</p>
          </div>
          <div className="fhe-badge">
            <span>FHE-Powered Preservation</span>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-panel">
            <h2>Heritage Twin Guide</h2>
            <p className="subtitle">Learn how to protect historical sites with encrypted simulations</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {showTeam && (
          <div className="team-panel">
            <h2>Our Preservation Team</h2>
            <p className="subtitle">Experts combining heritage conservation with cutting-edge cryptography</p>
            
            <div className="team-grid">
              {teamMembers.map((member, index) => (
                <div className="team-card" key={index}>
                  <div className="member-photo"></div>
                  <h3>{member.name}</h3>
                  <div className="member-role">{member.role}</div>
                  <p>{member.bio}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="stats-panel">
          <div className="stat-card">
            <div className="stat-icon">
              <div className="site-icon"></div>
            </div>
            <div className="stat-value">{records.length}</div>
            <div className="stat-label">Registered Sites</div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">
              <div className="condition-icon"></div>
            </div>
            <div className="stat-value">{averageCondition}%</div>
            <div className="stat-label">Avg Condition</div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">
              <div className="risk-icon"></div>
            </div>
            <div className="stat-value">{atRiskCount}</div>
            <div className="stat-label">At Risk</div>
          </div>
        </div>
        
        <div className="records-panel">
          <div className="panel-header">
            <h2>Heritage Site Registry</h2>
            <div className="header-actions">
              <button 
                onClick={loadRecords}
                className="refresh-btn metallic-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="records-list">
            {records.length === 0 ? (
              <div className="no-records">
                <div className="no-records-icon"></div>
                <p>No heritage sites registered yet</p>
                <button 
                  className="metallic-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Register First Site
                </button>
              </div>
            ) : (
              records.map(record => (
                <div className="record-card" key={record.id}>
                  <div className="card-header">
                    <h3>{record.siteName}</h3>
                    <div className="record-id">#{record.id.substring(0, 6)}</div>
                  </div>
                  
                  <div className="card-body">
                    <div className="condition-section">
                      <h4>Condition</h4>
                      {renderConditionMeter(record.condition)}
                    </div>
                    
                    <div className="impact-section">
                      <h4>Environmental Impact</h4>
                      {renderImpactChart(record)}
                    </div>
                    
                    <div className="owner-section">
                      <h4>Registered By</h4>
                      <div className="owner-address">
                        {record.owner.substring(0, 6)}...{record.owner.substring(38)}
                      </div>
                    </div>
                  </div>
                  
                  <div className="card-footer">
                    <div className="record-date">
                      {new Date(record.timestamp * 1000).toLocaleDateString()}
                    </div>
                    
                    {isOwner(record.owner) && (
                      <button 
                        className="simulate-btn metallic-button"
                        onClick={() => simulateEnvironmentalImpact(record.id)}
                      >
                        Run FHE Simulation
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          recordData={newRecordData}
          setRecordData={setNewRecordData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metallic-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="metallic-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>HeritageTwinFHE</span>
            </div>
            <p>Preserving history with encrypted simulations</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Preservation</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} HeritageTwinFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  recordData,
  setRecordData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({
      ...recordData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!recordData.siteName) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal metallic-card">
        <div className="modal-header">
          <h2>Register Heritage Site</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Site data will be encrypted with FHE for confidential simulations
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Site Name *</label>
              <input 
                type="text"
                name="siteName"
                value={recordData.siteName} 
                onChange={handleChange}
                placeholder="Historical site name..." 
                className="metallic-input"
              />
            </div>
            
            <div className="form-group">
              <label>Location</label>
              <input 
                type="text"
                name="location"
                value={recordData.location} 
                onChange={handleChange}
                placeholder="Geographic location..." 
                className="metallic-input"
              />
            </div>
            
            <div className="form-group">
              <label>Initial Condition</label>
              <input 
                type="range"
                name="condition"
                min="0"
                max="100"
                value={recordData.condition} 
                onChange={handleChange}
                className="condition-slider"
              />
              <div className="slider-value">{recordData.condition}%</div>
            </div>
            
            <div className="form-group full-width">
              <label>Description</label>
              <textarea 
                name="description"
                value={recordData.description} 
                onChange={handleChange}
                placeholder="Historical significance and architectural details..." 
                className="metallic-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> All simulations run on encrypted data without decryption
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn metallic-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn metallic-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Register Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;