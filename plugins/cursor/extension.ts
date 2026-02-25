/**
 * Safe Mode Cursor Extension
 *
 * VS Code extension providing Safe Mode integration for Cursor.
 */

import * as vscode from 'vscode';
import { existsSync, readFileSync, watchFile, unwatchFile } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ============================================================================
// Types
// ============================================================================

interface ActivityEntry {
  timestamp: number;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  message: string;
  toolName?: string;
  outcome?: string;
}

interface SafeModeStatus {
  active: boolean;
  preset: string;
  recentAlerts: number;
  recentBlocks: number;
}

// ============================================================================
// Activity Provider
// ============================================================================

class SafeModeActivityProvider implements vscode.TreeDataProvider<ActivityItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ActivityItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private activities: ActivityEntry[] = [];

  refresh(): void {
    this.loadActivities();
    this._onDidChangeTreeData.fire(undefined);
  }

  private loadActivities(): void {
    const activityPath = join(homedir(), '.safemode', 'activity.json');

    if (existsSync(activityPath)) {
      try {
        const content = readFileSync(activityPath, 'utf8');
        const data = JSON.parse(content);
        this.activities = Array.isArray(data) ? data.slice(-50) : [];
      } catch {
        this.activities = [];
      }
    } else {
      this.activities = [];
    }
  }

  getTreeItem(element: ActivityItem): vscode.TreeItem {
    return element;
  }

  getChildren(): Thenable<ActivityItem[]> {
    this.loadActivities();

    if (this.activities.length === 0) {
      return Promise.resolve([
        new ActivityItem('No activity yet', '', 'info', vscode.TreeItemCollapsibleState.None),
      ]);
    }

    return Promise.resolve(
      this.activities
        .reverse()
        .slice(0, 20)
        .map((entry) => {
          const time = new Date(entry.timestamp).toLocaleTimeString();
          return new ActivityItem(
            entry.message,
            time,
            entry.severity,
            vscode.TreeItemCollapsibleState.None
          );
        })
    );
  }
}

class ActivityItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    private time: string,
    private severity: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);

    this.description = this.time;
    this.iconPath = this.getIcon();
    this.tooltip = `${this.severity}: ${this.label}`;
  }

  private getIcon(): vscode.ThemeIcon {
    switch (this.severity) {
      case 'critical':
        return new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
      case 'high':
        return new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
      case 'medium':
        return new vscode.ThemeIcon('warning');
      case 'low':
        return new vscode.ThemeIcon('info');
      default:
        return new vscode.ThemeIcon('circle-outline');
    }
  }
}

// ============================================================================
// Status Provider
// ============================================================================

class SafeModeStatusProvider implements vscode.TreeDataProvider<StatusItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<StatusItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private status: SafeModeStatus = {
    active: false,
    preset: 'coding',
    recentAlerts: 0,
    recentBlocks: 0,
  };

  refresh(): void {
    this.loadStatus();
    this._onDidChangeTreeData.fire(undefined);
  }

  private loadStatus(): void {
    const configPath = join(homedir(), '.safemode', 'config.yaml');
    const statusPath = join(homedir(), '.safemode', 'status.json');

    // Check if Safe Mode is configured
    this.status.active = existsSync(configPath);

    // Load status if available
    if (existsSync(statusPath)) {
      try {
        const content = readFileSync(statusPath, 'utf8');
        const data = JSON.parse(content);
        this.status.preset = data.preset || 'coding';
        this.status.recentAlerts = data.recentAlerts || 0;
        this.status.recentBlocks = data.recentBlocks || 0;
      } catch {
        // Use defaults
      }
    }
  }

  getTreeItem(element: StatusItem): vscode.TreeItem {
    return element;
  }

  getChildren(): Thenable<StatusItem[]> {
    this.loadStatus();

    return Promise.resolve([
      new StatusItem(
        'Status',
        this.status.active ? 'Active' : 'Inactive',
        this.status.active ? 'pass' : 'error'
      ),
      new StatusItem('Preset', this.status.preset, 'settings-gear'),
      new StatusItem('Recent Alerts', this.status.recentAlerts.toString(), 'warning'),
      new StatusItem('Recent Blocks', this.status.recentBlocks.toString(), 'error'),
    ]);
  }
}

class StatusItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    private value: string,
    private icon: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);

    this.description = this.value;
    this.iconPath = new vscode.ThemeIcon(this.icon);
  }
}

// ============================================================================
// Status Bar
// ============================================================================

class SafeModeStatusBar {
  private statusBarItem: vscode.StatusBarItem;
  private configPath: string;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.configPath = join(homedir(), '.safemode', 'config.yaml');

    this.statusBarItem.command = 'safemode.showActivity';
    this.update();

    // Watch for config changes
    if (existsSync(this.configPath)) {
      watchFile(this.configPath, () => this.update());
    }
  }

  update(): void {
    const active = existsSync(this.configPath);

    if (active) {
      this.statusBarItem.text = '$(shield) Safe Mode';
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.tooltip = 'Safe Mode: Active';
    } else {
      this.statusBarItem.text = '$(shield) Safe Mode';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground'
      );
      this.statusBarItem.tooltip = 'Safe Mode: Not configured';
    }

    const showStatusBar = vscode.workspace
      .getConfiguration('safemode')
      .get('showStatusBar', true);

    if (showStatusBar) {
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  dispose(): void {
    if (existsSync(this.configPath)) {
      unwatchFile(this.configPath);
    }
    this.statusBarItem.dispose();
  }
}

// ============================================================================
// Extension Activation
// ============================================================================

let statusBar: SafeModeStatusBar | undefined;

export function activate(context: vscode.ExtensionContext): void {
  console.log('Safe Mode extension activating...');

  // Create providers
  const activityProvider = new SafeModeActivityProvider();
  const statusProvider = new SafeModeStatusProvider();

  // Register tree views
  vscode.window.registerTreeDataProvider('safemode-activity', activityProvider);
  vscode.window.registerTreeDataProvider('safemode-status', statusProvider);

  // Create status bar
  statusBar = new SafeModeStatusBar();
  context.subscriptions.push({ dispose: () => statusBar?.dispose() });

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('safemode.showActivity', () => {
      vscode.commands.executeCommand('workbench.view.extension.safemode');
    }),

    vscode.commands.registerCommand('safemode.togglePreset', async () => {
      const presets = ['yolo', 'coding', 'personal', 'trading', 'strict'];
      const current = vscode.workspace
        .getConfiguration('safemode')
        .get('preset', 'coding');

      const selected = await vscode.window.showQuickPick(
        presets.map((p) => ({
          label: p,
          description: p === current ? '(current)' : undefined,
        })),
        { placeHolder: 'Select a preset' }
      );

      if (selected) {
        await vscode.workspace
          .getConfiguration('safemode')
          .update('preset', selected.label, vscode.ConfigurationTarget.Global);

        vscode.window.showInformationMessage(
          `Safe Mode preset changed to: ${selected.label}`
        );

        statusProvider.refresh();
      }
    }),

    vscode.commands.registerCommand('safemode.viewHistory', async () => {
      const terminal = vscode.window.createTerminal('Safe Mode History');
      terminal.sendText('safemode history --limit 50');
      terminal.show();
    }),

    vscode.commands.registerCommand('safemode.openSettings', () => {
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'safemode'
      );
    })
  );

  // Refresh periodically
  const refreshInterval = setInterval(() => {
    activityProvider.refresh();
    statusProvider.refresh();
    statusBar?.update();
  }, 5000);

  context.subscriptions.push({
    dispose: () => clearInterval(refreshInterval),
  });

  console.log('Safe Mode extension activated');
}

export function deactivate(): void {
  console.log('Safe Mode extension deactivated');
}
