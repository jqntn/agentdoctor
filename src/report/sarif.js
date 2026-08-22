import { relative, isAbsolute } from 'node:path';
import { allRules } from '../rules/index.js';
import { REPO_URL } from '../links.js';

const SARIF_LEVEL = { error: 'error', warning: 'warning', info: 'note' };

/**
 * SARIF 2.1.0 output, so findings surface as annotations in GitHub code
 * scanning and any other SARIF-aware CI without extra glue.
 */
export function renderSarif(input) {
  const usedRuleIds = [...new Set(input.findings.map((f) => f.ruleId))];
  const ruleIndex = new Map();
  const rules = usedRuleIds.map((id, index) => {
    ruleIndex.set(id, index);
    const rule = allRules.find((r) => r.id === id);
    return {
      id,
      name: id.replace(/[^A-Za-z0-9]/g, '_'),
      shortDescription: { text: rule?.title ?? id },
      fullDescription: { text: rule?.help ?? rule?.title ?? id },
      help: { text: rule?.help ?? '' },
      defaultConfiguration: { level: SARIF_LEVEL[rule?.severity ?? 'warning'] ?? 'warning' },
      properties: { category: rule?.category ?? 'other', tags: [rule?.category ?? 'other', 'agentdoctor'] },
    };
  });

  return JSON.stringify({
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'agentdoctor',
          version: input.version,
          informationUri: REPO_URL,
          rules,
        },
      },
      results: input.findings.map((finding) => ({
        ruleId: finding.ruleId,
        ruleIndex: ruleIndex.get(finding.ruleId),
        level: SARIF_LEVEL[finding.severity] ?? 'warning',
        message: { text: finding.help ? `${finding.message} ${finding.help}` : finding.message },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: toUri(finding.file, input.workspace.root) },
            region: {
              startLine: Math.max(1, finding.line),
              ...(finding.column ? { startColumn: finding.column } : {}),
            },
          },
        }],
        partialFingerprints: {
          agentdoctorFingerprint: `${finding.ruleId}:${finding.display}:${finding.configPath ?? finding.line}`,
        },
      })),
    }],
  }, null, 2);
}

function toUri(absolutePath, root) {
  if (!isAbsolute(absolutePath)) return absolutePath;
  const rel = relative(root, absolutePath);
  // Paths outside the repo (user-scope config) have no meaningful CI location;
  // keep a short suffix rather than leaking an absolute home directory.
  return rel.startsWith('..') ? absolutePath.split('/').slice(-3).join('/') : rel;
}
