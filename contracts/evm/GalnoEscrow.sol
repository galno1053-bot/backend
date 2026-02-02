// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract GalnoEscrow {
    address public owner;

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed to, uint256 amount);

    constructor(address _owner) {
        owner = _owner;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    function deposit() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(address to, uint256 amount) external onlyOwner {
        require(address(this).balance >= amount, "insufficient");
        (bool ok, ) = to.call{ value: amount }("");
        require(ok, "transfer failed");
        emit Withdraw(to, amount);
    }
}
