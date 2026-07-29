import { readFile, writeFile } from 'node:fs/promises';

const path = 'npp-core/web/app/inventory/inventory-workspace.tsx';
let source = await readFile(path, 'utf8');

function replaceRequired(before, after) {
  if (!source.includes(before)) throw new Error(`Missing fragment:\n${before}`);
  source = source.split(before).join(after);
}

function removeRegex(pattern) {
  const matches = source.match(pattern);
  if (!matches || matches.length !== 1) throw new Error(`Expected one match for ${pattern}; found ${matches?.length ?? 0}`);
  source = source.replace(pattern, '');
}

replaceRequired('  upperCode,\n', '');
removeRegex(/type OpeningDraft = \{[\s\S]*?\};\n\ntype ValidationState = \{[\s\S]*?\} \| null;\n\n/);
removeRegex(/function canonicalize\(value: unknown\): unknown \{[\s\S]*?\n\}\n\nasync function sha256Hex\(value: string\): Promise<string> \{[\s\S]*?\n\}\n\n/);
removeRegex(/function emptyOpeningDraft\(\): OpeningDraft \{[\s\S]*?\n\}\n\nfunction safeJsonObject\(value: string\): Record<string, unknown> \{[\s\S]*?\n\}\n\nfunction safeJsonArray\(value: string\): unknown\[\] \{[\s\S]*?\n\}\n\n/);
replaceRequired('  const [openingDraft, setOpeningDraft] = useState<OpeningDraft>(emptyOpeningDraft());\n  const [validation, setValidation] = useState<ValidationState>(null);\n  const [openingResult, setOpeningResult] = useState<Record<string, unknown> | null>(null);\n', '');
removeRegex(/  async function validateOpeningBalance\(\) \{[\s\S]*?\n  \}\n\n  async function postOpeningBalance\(\) \{[\s\S]*?\n  \}\n\n/);

await writeFile(path, source);
console.log('Removed obsolete JSON opening-balance code');
