use anchor_lang::prelude::*;

declare_id!("GALNO11111111111111111111111111111111111");

#[program]
pub mod galno_escrow {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.config.authority = ctx.accounts.authority.key();
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.user.key(),
            &ctx.accounts.vault.key(),
            amount,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[ctx.accounts.user.to_account_info(), ctx.accounts.vault.to_account_info()],
        )?;
        msg!("GALNO_DEPOSIT: user={} amount={}", ctx.accounts.user.key(), amount);
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(ctx.accounts.config.authority == ctx.accounts.authority.key(), GalnoError::Unauthorized);
        let seeds: &[&[u8]] = &[b"vault", &[ctx.bumps.vault]];
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.vault.key(),
            &ctx.accounts.recipient.key(),
            amount,
        );
        anchor_lang::solana_program::program::invoke_signed(
            &ix,
            &[ctx.accounts.vault.to_account_info(), ctx.accounts.recipient.to_account_info()],
            &[seeds],
        )?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + 32, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(init_if_needed, payer = user, space = 8, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub recipient: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Config {
    pub authority: Pubkey,
}

#[account]
pub struct Vault {}

#[error_code]
pub enum GalnoError {
    #[msg("Unauthorized")]
    Unauthorized,
}
