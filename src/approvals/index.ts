/**
 * Approvals Module
 *
 * Provides phone/remote approval capabilities via Telegram and Discord.
 */

export {
  TelegramApprovalProvider,
} from './telegram.js';
export type {
  TelegramConfig,
} from './telegram.js';

export {
  DiscordApprovalProvider,
} from './discord.js';
export type {
  DiscordConfig,
} from './discord.js';

export {
  ApprovalManager,
  getApprovalManager,
  configureApprovalManager,
} from './manager.js';
export type {
  ApprovalRequest,
  ApprovalResponse,
  ApprovalManagerConfig,
} from './manager.js';
