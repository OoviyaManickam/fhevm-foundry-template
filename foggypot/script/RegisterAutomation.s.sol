// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";

interface LinkTokenInterface {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface AutomationRegistrarInterface {
    struct RegistrationParams {
        string name;
        bytes encryptedEmail;
        address upkeepContract;
        uint32 gasLimit;
        address adminAddress;
        uint8 triggerType;
        bytes checkData;
        bytes triggerConfig;
        bytes offchainConfig;
        uint96 amount;
    }

    function registerUpkeep(RegistrationParams calldata requestParams) external returns (uint256);
}

/// @notice Registers FoggyPotDrawKeeper as a Chainlink Automation "custom logic" upkeep on
/// Sepolia, funded with LINK. Run with:
///   forge script script/RegisterAutomation.s.sol --rpc-url <RPC> --account rahul --broadcast
/// Set DRAWKEEPER_ADDRESS and (optionally) LINK_FUNDING_AMOUNT via env vars first.
