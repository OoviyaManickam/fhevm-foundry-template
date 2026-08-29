// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockUSDC
/// @notice Plaintext test ERC-20 (6 decimals) with a public faucet. Deposited into FoggyPot
/// pools, where amounts become encrypted. This token itself carries no confidentiality.
contract MockUSDC is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 1_000 * 10 ** 6; // 1,000 mUSDC
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    mapping(address => uint256) public lastFaucetClaim;

    constructor() ERC20("Mock USDC", "mUSDC") Ownable(msg.sender) {}

    /// @notice Unrestricted-amount mint, deployer-only. Used to seed Reserve balances and tests
    /// without waiting out the faucet cooldown; regular users always go through faucet().
