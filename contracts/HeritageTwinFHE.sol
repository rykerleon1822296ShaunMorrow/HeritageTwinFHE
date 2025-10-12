// HeritageTwinFHE.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract HeritageTwinFHE is SepoliaConfig {
    struct EncryptedSiteModel {
        uint256 id;
        euint32 encrypted3DModel;
        euint32 encryptedMaterialData;
        euint32 encryptedStructuralData;
        uint256 timestamp;
    }
    
    struct SimulationResult {
        euint32 encryptedDamageScore;
        euint32 encryptedRiskAssessment;
        euint32 encryptedPreservationScore;
    }

    struct DecryptedSiteModel {
        string model3D;
        string materialData;
        string structuralData;
        bool isRevealed;
    }

    uint256 public siteCount;
    mapping(uint256 => EncryptedSiteModel) public encryptedSiteModels;
    mapping(uint256 => DecryptedSiteModel) public decryptedSiteModels;
    mapping(uint256 => SimulationResult) public simulationResults;
    
    mapping(uint256 => uint256) private requestToSiteId;
    
    event SiteModelUploaded(uint256 indexed id, uint256 timestamp);
    event SimulationRequested(uint256 indexed siteId);
    event SimulationCompleted(uint256 indexed siteId);
    event DecryptionRequested(uint256 indexed siteId);
    event SiteModelDecrypted(uint256 indexed siteId);
    
    modifier onlyCurator(uint256 siteId) {
        _;
    }
    
    function uploadEncryptedSiteModel(
        euint32 encrypted3DModel,
        euint32 encryptedMaterialData,
        euint32 encryptedStructuralData
    ) public {
        siteCount += 1;
        uint256 newId = siteCount;
        
        encryptedSiteModels[newId] = EncryptedSiteModel({
            id: newId,
            encrypted3DModel: encrypted3DModel,
            encryptedMaterialData: encryptedMaterialData,
            encryptedStructuralData: encryptedStructuralData,
            timestamp: block.timestamp
        });
        
        decryptedSiteModels[newId] = DecryptedSiteModel({
            model3D: "",
            materialData: "",
            structuralData: "",
            isRevealed: false
        });
        
        emit SiteModelUploaded(newId, block.timestamp);
    }
    
    function requestSiteModelDecryption(uint256 siteId) public onlyCurator(siteId) {
        EncryptedSiteModel storage model = encryptedSiteModels[siteId];
        require(!decryptedSiteModels[siteId].isRevealed, "Already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(model.encrypted3DModel);
        ciphertexts[1] = FHE.toBytes32(model.encryptedMaterialData);
        ciphertexts[2] = FHE.toBytes32(model.encryptedStructuralData);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptSiteModel.selector);
        requestToSiteId[reqId] = siteId;
        
        emit DecryptionRequested(siteId);
    }
    
    function decryptSiteModel(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 siteId = requestToSiteId[requestId];
        require(siteId != 0, "Invalid request");
        
        EncryptedSiteModel storage eModel = encryptedSiteModels[siteId];
        DecryptedSiteModel storage dModel = decryptedSiteModels[siteId];
        require(!dModel.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        string[] memory results = abi.decode(cleartexts, (string[]));
        
        dModel.model3D = results[0];
        dModel.materialData = results[1];
        dModel.structuralData = results[2];
        dModel.isRevealed = true;
        
        emit SiteModelDecrypted(siteId);
    }
    
    function requestEnvironmentalSimulation(uint256 siteId) public onlyCurator(siteId) {
        require(encryptedSiteModels[siteId].id != 0, "Site not found");
        
        emit SimulationRequested(siteId);
    }
    
    function submitSimulationResults(
        uint256 siteId,
        euint32 encryptedDamageScore,
        euint32 encryptedRiskAssessment,
        euint32 encryptedPreservationScore
    ) public {
        simulationResults[siteId] = SimulationResult({
            encryptedDamageScore: encryptedDamageScore,
            encryptedRiskAssessment: encryptedRiskAssessment,
            encryptedPreservationScore: encryptedPreservationScore
        });
        
        emit SimulationCompleted(siteId);
    }
    
    function requestResultDecryption(uint256 siteId, uint8 resultType) public onlyCurator(siteId) {
        SimulationResult storage result = simulationResults[siteId];
        require(FHE.isInitialized(result.encryptedDamageScore), "No results available");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        
        if (resultType == 0) {
            ciphertexts[0] = FHE.toBytes32(result.encryptedDamageScore);
        } else if (resultType == 1) {
            ciphertexts[0] = FHE.toBytes32(result.encryptedRiskAssessment);
        } else if (resultType == 2) {
            ciphertexts[0] = FHE.toBytes32(result.encryptedPreservationScore);
        } else {
            revert("Invalid result type");
        }
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptSimulationResult.selector);
        requestToSiteId[reqId] = siteId * 10 + resultType;
    }
    
    function decryptSimulationResult(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 compositeId = requestToSiteId[requestId];
        uint256 siteId = compositeId / 10;
        uint8 resultType = uint8(compositeId % 10);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 result = abi.decode(cleartexts, (uint32));
    }
    
    function getDecryptedSiteModel(uint256 siteId) public view returns (
        string memory model3D,
        string memory materialData,
        string memory structuralData,
        bool isRevealed
    ) {
        DecryptedSiteModel storage m = decryptedSiteModels[siteId];
        return (m.model3D, m.materialData, m.structuralData, m.isRevealed);
    }
    
    function hasSimulationResults(uint256 siteId) public view returns (bool) {
        return FHE.isInitialized(simulationResults[siteId].encryptedDamageScore);
    }
}