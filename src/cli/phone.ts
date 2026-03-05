/**
 * Phone Setup Command
 *
 * Configure Telegram or Discord notifications for Safe Mode block events.
 */

import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'node:fs';
import * as readline from 'node:readline';
import yaml from 'js-yaml';
import { CONFIG_PATHS } from '../config/index.js';
import { TelegramApprovalProvider } from '../approvals/telegram.js';
import { DiscordApprovalProvider } from '../approvals/discord.js';

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function loadConfig(): Record<string, unknown> {
  const configPath = CONFIG_PATHS.personalConfig;
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    return (yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>) || {};
  } catch {
    return {};
  }
}

function saveConfig(config: Record<string, unknown>): void {
  fs.writeFileSync(CONFIG_PATHS.personalConfig, yaml.dump(config));
}

export async function phoneCommand(options: {
  telegram?: boolean;
  discord?: boolean;
  test?: boolean;
  disable?: boolean;
}): Promise<void> {
  if (options.disable) {
    const config = loadConfig();
    delete config.notifications;
    saveConfig(config);
    console.log(chalk.green('  \u2713 Notifications disabled'));
    return;
  }

  if (options.test) {
    return testNotification();
  }

  if (options.telegram) {
    return setupTelegram();
  }

  if (options.discord) {
    return setupDiscord();
  }

  console.log(chalk.bold('\n  Phone Notification Setup\n'));
  console.log('  Usage:');
  console.log('    safemode phone --telegram    Set up Telegram notifications');
  console.log('    safemode phone --discord     Set up Discord notifications');
  console.log('    safemode phone --test        Test current notification setup');
  console.log('    safemode phone --disable     Disable notifications');
  console.log();
}

async function setupTelegram(): Promise<void> {
  console.log(chalk.bold('\n  Telegram Setup\n'));
  console.log(chalk.gray('  1. Message @BotFather on Telegram to create a bot'));
  console.log(chalk.gray('  2. Copy the bot token'));
  console.log(chalk.gray('  3. Get your chat ID by messaging @userinfobot'));
  console.log();

  const botToken = await prompt('  Bot token: ');
  if (!botToken) {
    console.log(chalk.yellow('  Cancelled.'));
    return;
  }

  const chatId = await prompt('  Chat ID: ');
  if (!chatId) {
    console.log(chalk.yellow('  Cancelled.'));
    return;
  }

  // Test connection
  const spinner = ora('Testing Telegram connection...').start();
  const provider = new TelegramApprovalProvider({ botToken, chatId });
  const ok = await provider.testConnection();
  spinner.stop();

  if (!ok) {
    console.log(chalk.red('  \u2717 Connection failed. Check your bot token and chat ID.'));
    return;
  }

  console.log(chalk.green('  \u2713 Connection successful!'));

  // Save to config
  const config = loadConfig();
  config.notifications = {
    provider: 'telegram',
    telegram: { bot_token: botToken, chat_id: chatId },
  };
  saveConfig(config);
  console.log(chalk.green('  \u2713 Telegram notifications configured'));
  console.log();
}

async function setupDiscord(): Promise<void> {
  console.log(chalk.bold('\n  Discord Setup\n'));
  console.log(chalk.gray('  1. Go to your Discord server settings'));
  console.log(chalk.gray('  2. Create a webhook in Integrations > Webhooks'));
  console.log(chalk.gray('  3. Copy the webhook URL'));
  console.log();

  const webhookUrl = await prompt('  Webhook URL: ');
  if (!webhookUrl) {
    console.log(chalk.yellow('  Cancelled.'));
    return;
  }

  // Test connection
  const spinner = ora('Testing Discord connection...').start();
  const provider = new DiscordApprovalProvider({ webhookUrl });
  const ok = await provider.testConnection();
  spinner.stop();

  if (!ok) {
    console.log(chalk.red('  \u2717 Connection failed. Check your webhook URL.'));
    return;
  }

  console.log(chalk.green('  \u2713 Connection successful!'));

  // Save to config
  const config = loadConfig();
  config.notifications = {
    provider: 'discord',
    discord: { webhook_url: webhookUrl },
  };
  saveConfig(config);
  console.log(chalk.green('  \u2713 Discord notifications configured'));
  console.log();
}

async function testNotification(): Promise<void> {
  const config = loadConfig();
  const notifications = config.notifications as {
    provider?: string;
    telegram?: { bot_token: string; chat_id: string };
    discord?: { webhook_url: string };
  } | undefined;

  if (!notifications?.provider) {
    console.log(chalk.yellow('  No notification provider configured.'));
    console.log(chalk.gray('  Run `safemode phone --telegram` or `safemode phone --discord` to set up.'));
    return;
  }

  const spinner = ora('Sending test notification...').start();

  if (notifications.provider === 'telegram' && notifications.telegram) {
    const provider = new TelegramApprovalProvider({
      botToken: notifications.telegram.bot_token,
      chatId: notifications.telegram.chat_id,
    });
    const ok = await provider.sendNotification(
      'Safe Mode Test',
      'This is a test notification from Safe Mode.'
    );
    spinner.stop();
    if (ok) {
      console.log(chalk.green('  \u2713 Test notification sent to Telegram'));
    } else {
      console.log(chalk.red('  \u2717 Failed to send Telegram notification'));
    }
  } else if (notifications.provider === 'discord' && notifications.discord) {
    const provider = new DiscordApprovalProvider({
      webhookUrl: notifications.discord.webhook_url,
    });
    const ok = await provider.sendNotification(
      'Safe Mode Test',
      'This is a test notification from Safe Mode.'
    );
    spinner.stop();
    if (ok) {
      console.log(chalk.green('  \u2713 Test notification sent to Discord'));
    } else {
      console.log(chalk.red('  \u2717 Failed to send Discord notification'));
    }
  } else {
    spinner.stop();
    console.log(chalk.red(`  Unknown provider: ${notifications.provider}`));
  }
}
