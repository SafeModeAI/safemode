/**
 * First-Run Scanner
 *
 * Scans the environment for potential security issues.
 * Runs during `safemode init` to detect problems early.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { glob } from 'glob';

// ============================================================================
// Types
// ============================================================================

export interface ScanFinding {
  type: 'secret' | 'permission' | 'config' | 'env';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  path?: string;
  recommendation?: string;
}

export interface ScanResult {
  findings: ScanFinding[];
  scanned_files: number;
  scan_duration_ms: number;
}

// ============================================================================
// Secret Patterns
// ============================================================================

const SECRET_FILE_PATTERNS = [
  '**/.env',
  '**/.env.*',
  '**/credentials.json',
  '**/secrets.json',
  '**/config.json',
  '**/*.pem',
  '**/*.key',
  '**/id_rsa',
  '**/id_ed25519',
  '**/.aws/credentials',
  '**/.npmrc',
];

const SECRET_CONTENT_PATTERNS = [
  { pattern: /AKIA[0-9A-Z]{16}/g, name: 'AWS Access Key' },
  { pattern: /sk_live_[A-Za-z0-9]{24,}/g, name: 'Stripe Live Key' },
  { pattern: /ghp_[A-Za-z0-9]{36}/g, name: 'GitHub PAT' },
  { pattern: /sk-[A-Za-z0-9]{48}/g, name: 'OpenAI API Key' },
  { pattern: /sk-ant-[A-Za-z0-9_-]{90,}/g, name: 'Anthropic API Key' },
  { pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g, name: 'Private Key' },
];

// ============================================================================
// First-Run Scanner
// ============================================================================

export class FirstRunScanner {
  private homeDir: string;
  private maxFilesToScan = 1000;
  private maxFileSize = 1024 * 1024; // 1MB

  constructor() {
    this.homeDir = os.homedir();
  }

  /**
   * Run a full scan
   */
  async scan(): Promise<ScanResult> {
    const startTime = performance.now();
    const findings: ScanFinding[] = [];
    let scannedFiles = 0;

    // Scan for secret files
    const secretFindings = await this.scanForSecretFiles();
    findings.push(...secretFindings.findings);
    scannedFiles += secretFindings.scanned;

    // Scan for environment issues
    const envFindings = this.scanEnvironment();
    findings.push(...envFindings);

    // Scan for config issues
    const configFindings = await this.scanConfigs();
    findings.push(...configFindings);

    const duration = performance.now() - startTime;

    return {
      findings,
      scanned_files: scannedFiles,
      scan_duration_ms: Math.round(duration),
    };
  }

  /**
   * Scan for files that may contain secrets
   */
  private async scanForSecretFiles(): Promise<{
    findings: ScanFinding[];
    scanned: number;
  }> {
    const findings: ScanFinding[] = [];
    let scanned = 0;

    // Find potential secret files
    for (const pattern of SECRET_FILE_PATTERNS) {
      try {
        const files = await glob(pattern, {
          cwd: this.homeDir,
          absolute: true,
          nodir: true,
          ignore: ['**/node_modules/**', '**/.git/**'],
        });

        for (const file of files.slice(0, 100)) {
          if (scanned >= this.maxFilesToScan) break;

          try {
            const stats = fs.statSync(file);
            if (stats.size > this.maxFileSize) continue;

            const content = fs.readFileSync(file, 'utf8');
            scanned++;

            // Check for secret patterns
            for (const { pattern: secretPattern, name } of SECRET_CONTENT_PATTERNS) {
              secretPattern.lastIndex = 0;
              if (secretPattern.test(content)) {
                findings.push({
                  type: 'secret',
                  severity: 'high',
                  description: `${name} found in file`,
                  path: file,
                  recommendation: 'Consider using environment variables or a secrets manager',
                });
                break; // One finding per file
              }
            }
          } catch {
            // Skip files we can't read
          }
        }
      } catch {
        // Skip glob errors
      }
    }

    return { findings, scanned };
  }

  /**
   * Scan environment for issues
   */
  private scanEnvironment(): ScanFinding[] {
    const findings: ScanFinding[] = [];

    // Check for sensitive environment variables that might be exposed
    const sensitiveEnvVars = [
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'STRIPE_SECRET_KEY',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'GITHUB_TOKEN',
      'NPM_TOKEN',
    ];

    for (const envVar of sensitiveEnvVars) {
      if (process.env[envVar]) {
        findings.push({
          type: 'env',
          severity: 'medium',
          description: `${envVar} is set in environment`,
          recommendation: 'Ensure this is intentional and not exposed to untrusted code',
        });
      }
    }

    return findings;
  }

  /**
   * Scan MCP and related configs
   */
  private async scanConfigs(): Promise<ScanFinding[]> {
    const findings: ScanFinding[] = [];

    // Check for insecure MCP server configurations
    const mcpConfigPaths = [
      path.join(this.homeDir, 'Library/Application Support/Claude/claude_desktop_config.json'),
      path.join(this.homeDir, '.cursor/mcp.json'),
      path.join(this.homeDir, '.claude/mcp_servers.json'),
    ];

    for (const configPath of mcpConfigPaths) {
      if (!fs.existsSync(configPath)) continue;

      try {
        const content = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(content);

        if (config.mcpServers) {
          for (const [name, server] of Object.entries(config.mcpServers)) {
            const serverConfig = server as { command?: string; args?: string[] };

            // Check for sudo usage
            if (serverConfig.command === 'sudo') {
              findings.push({
                type: 'config',
                severity: 'high',
                description: `MCP server "${name}" runs with sudo`,
                path: configPath,
                recommendation: 'Avoid running MCP servers as root',
              });
            }

            // Check for shell execution
            const args = serverConfig.args?.join(' ') || '';
            if (args.includes('sh -c') || args.includes('bash -c')) {
              findings.push({
                type: 'config',
                severity: 'medium',
                description: `MCP server "${name}" uses shell execution`,
                path: configPath,
                recommendation: 'Consider using direct command execution',
              });
            }
          }
        }
      } catch {
        // Skip invalid configs
      }
    }

    return findings;
  }
}
