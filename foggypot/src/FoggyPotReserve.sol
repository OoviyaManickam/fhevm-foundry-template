// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title FoggyPotReserve
/// @notice Holds this pool's admin-funded mock yield, in the same token the pool accepts.
/// No conversion, no cross-pool sharing. Yield is entirely simulated: the admin transfers real
/// tokens in via fund(), and the associated PrizePool pulls plaintext amounts out at draw time
/// to back the encrypted prizes it credits.
contract FoggyPotReserve is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public prizePool;

    event Funded(address indexed from, uint256 amount);
    event Released(address indexed to, uint256 amount);
    event PrizePoolSet(address indexed prizePool);

    modifier onlyPrizePool() {
        require(msg.sender == prizePool, "Reserve: not prize pool");
        _;
    }

    constructor(address admin, IERC20 token_) Ownable(admin) {
        token = token_;
    }

    /// @notice One-time wiring of the PrizePool allowed to pull funds. Admin-only.
    function setPrizePool(address prizePool_) external onlyOwner {
        require(prizePool == address(0), "Reserve: already set");
        require(prizePool_ != address(0), "Reserve: zero address");
        prizePool = prizePool_;
        emit PrizePoolSet(prizePool_);
    }

    /// @notice Admin funds this pool's mock yield reserve. Requires prior ERC20 approval.
    function fund(uint256 amount) external onlyOwner {
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    /// @notice Called by the PrizePool during runDraw() to move prize tokens into the Vault.
