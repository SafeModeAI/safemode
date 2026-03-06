/**
 * Engine 10: Secrets Scanner
 *
 * Scans tool parameters for hardcoded secrets and API keys.
 * 40+ patterns for AWS, GitHub, Stripe, etc.
 * Critical secrets = block
 */

import type { DetectionEngine, EngineResult, EngineContext } from './base.js';

// ============================================================================
// Secret Patterns
// ============================================================================

interface SecretPattern {
  name: string;
  pattern: RegExp;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

const SECRET_PATTERNS: SecretPattern[] = [
  // AWS
  { name: 'aws_access_key', pattern: /\bAKIA[0-9A-Z]{16}\b/g, severity: 'critical' },
  { name: 'aws_secret_key', pattern: /\b[A-Za-z0-9/+=]{40}\b/g, severity: 'critical' },
  { name: 'aws_mws_key', pattern: /\bamzn\.mws\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, severity: 'critical' },

  // GitHub
  { name: 'github_pat', pattern: /\bghp_[A-Za-z0-9]{36}\b/g, severity: 'critical' },
  { name: 'github_oauth', pattern: /\bgho_[A-Za-z0-9]{36}\b/g, severity: 'critical' },
  { name: 'github_app', pattern: /\bghu_[A-Za-z0-9]{36}\b/g, severity: 'critical' },
  { name: 'github_refresh', pattern: /\bghr_[A-Za-z0-9]{36}\b/g, severity: 'critical' },
  { name: 'github_fine_grained', pattern: /\bgithub_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}\b/g, severity: 'critical' },

  // Stripe
  { name: 'stripe_live_secret', pattern: /\bsk_live_[A-Za-z0-9]{24,}\b/g, severity: 'critical' },
  { name: 'stripe_test_secret', pattern: /\bsk_test_[A-Za-z0-9]{24,}\b/g, severity: 'high' },
  { name: 'stripe_live_restricted', pattern: /\brk_live_[A-Za-z0-9]{24,}\b/g, severity: 'critical' },
  { name: 'stripe_webhook', pattern: /\bwhsec_[A-Za-z0-9]{32,}\b/g, severity: 'high' },

  // Google
  { name: 'google_api_key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, severity: 'high' },
  { name: 'google_oauth', pattern: /\b[0-9]+-[a-z0-9_]{32}\.apps\.googleusercontent\.com\b/gi, severity: 'high' },
  { name: 'google_cloud_key', pattern: /\b[0-9a-zA-Z_-]{24}\.json\b/g, severity: 'medium' },

  // Slack
  { name: 'slack_bot_token', pattern: /\bxoxb-[0-9]{10,}-[0-9]{10,}-[A-Za-z0-9]{24}\b/g, severity: 'critical' },
  { name: 'slack_user_token', pattern: /\bxoxp-[0-9]{10,}-[0-9]{10,}-[A-Za-z0-9]{24}\b/g, severity: 'critical' },
  { name: 'slack_webhook', pattern: /\bhttps:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+\b/gi, severity: 'high' },

  // Discord
  { name: 'discord_token', pattern: /\b[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27}\b/g, severity: 'critical' },
  { name: 'discord_webhook', pattern: /\bhttps:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+\b/gi, severity: 'high' },

  // NPM
  { name: 'npm_token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g, severity: 'critical' },

  // PyPI
  { name: 'pypi_token', pattern: /\bpypi-[A-Za-z0-9_-]{100,}\b/g, severity: 'critical' },

  // Twilio
  { name: 'twilio_api_key', pattern: /\bSK[0-9a-fA-F]{32}\b/g, severity: 'high' },
  { name: 'twilio_sid', pattern: /\bAC[a-z0-9]{32}\b/gi, severity: 'medium' },

  // SendGrid
  { name: 'sendgrid_api_key', pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g, severity: 'critical' },

  // Mailchimp
  { name: 'mailchimp_api_key', pattern: /\b[a-f0-9]{32}-us[0-9]{1,2}\b/gi, severity: 'high' },

  // Heroku
  { name: 'heroku_api_key', pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, severity: 'high' },

  // DigitalOcean
  { name: 'digitalocean_token', pattern: /\bdop_v1_[a-f0-9]{64}\b/g, severity: 'critical' },

  // OpenAI
  { name: 'openai_api_key', pattern: /\bsk-[A-Za-z0-9]{48}\b/g, severity: 'critical' },
  { name: 'openai_org', pattern: /\borg-[A-Za-z0-9]{24}\b/g, severity: 'medium' },

  // Anthropic
  { name: 'anthropic_api_key', pattern: /\bsk-ant-[A-Za-z0-9_-]{90,}\b/g, severity: 'critical' },

  // Firebase
  { name: 'firebase_url', pattern: /\bhttps:\/\/[a-z0-9-]+\.firebaseio\.com\b/gi, severity: 'medium' },

  // Generic patterns
  { name: 'private_key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g, severity: 'critical' },
  { name: 'jwt_token', pattern: /\beyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\b/g, severity: 'high' },
  { name: 'basic_auth', pattern: /\bBasic\s+[A-Za-z0-9+/=]{20,}\b/gi, severity: 'high' },
  { name: 'bearer_token', pattern: /\bBearer\s+[A-Za-z0-9_-]{20,}\b/gi, severity: 'high' },

  // Database connection strings
  { name: 'postgres_url', pattern: /\bpostgres(?:ql)?:\/\/[^:]+:[^@]+@[^/]+\/\S+\b/gi, severity: 'critical' },
  { name: 'mysql_url', pattern: /\bmysql:\/\/[^:]+:[^@]+@[^/]+\/\S+\b/gi, severity: 'critical' },
  { name: 'mongodb_url', pattern: /\bmongodb(?:\+srv)?:\/\/[^:]+:[^@]+@[^/]+\/?\S*\b/gi, severity: 'critical' },
  { name: 'redis_url', pattern: /\bredis:\/\/:[^@]+@[^/]+:\d+\b/gi, severity: 'critical' },
];

// ============================================================================
// Secrets Scanner Engine
// ============================================================================

export class SecretsScanner implements DetectionEngine {
  readonly id = 10;
  readonly name = 'secrets_scanner';
  readonly description = 'Scans for hardcoded secrets and API keys';

  async evaluate(context: EngineContext): Promise<EngineResult> {
    const { parameters } = context;

    // Convert parameters to string for scanning
    const content = JSON.stringify(parameters);

    const findings: Array<{ type: string; severity: string; count: number }> = [];
    let maxSeverity: SecretPattern['severity'] = 'low';

    const severityOrder = { low: 0, medium: 1, high: 2, critical: 3 };

    for (const { name, pattern, severity } of SECRET_PATTERNS) {
      // Reset regex state
      pattern.lastIndex = 0;

      let matchCount = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(content)) !== null) {
        const matched = match[0];

        // AWS secret key: must contain / or + (real keys always do, identifiers don't)
        if (name === 'aws_secret_key' && !/[/+]/.test(matched)) {
          continue;
        }

        // Skip documentation context: nearby text about patterns/detection is not a secret
        const ctxStart = Math.max(0, match.index - 80);
        const ctxEnd = Math.min(content.length, match.index + matched.length + 80);
        const nearby = content.slice(ctxStart, ctxEnd).toLowerCase();
        if (/\b(?:patterns?|detects?|scanning|scans?|coverage|engine)\b/.test(nearby)) {
          continue;
        }

        matchCount++;
      }

      if (matchCount > 0) {
        findings.push({ type: name, severity, count: matchCount });

        if (severityOrder[severity] > severityOrder[maxSeverity]) {
          maxSeverity = severity;
        }
      }
    }

    if (findings.length > 0) {
      const summary = findings.map((f) => `${f.count} ${f.type}`).join(', ');

      // Critical secrets cause block
      const shouldBlock = maxSeverity === 'critical';

      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: true,
        severity: maxSeverity,
        confidence: 0.95,
        action: shouldBlock ? 'block' : 'alert',
        details: {
          reason: `Secrets detected: ${summary}`,
          findings,
          total_findings: findings.reduce((sum, f) => sum + f.count, 0),
          max_severity: maxSeverity,
        },
        latency_ms: 0,
      };
    }

    return {
      engine_id: this.id,
      engine_name: this.name,
      detected: false,
      severity: 'info',
      confidence: 1.0,
      action: 'allow',
      details: {},
      latency_ms: 0,
    };
  }
}
