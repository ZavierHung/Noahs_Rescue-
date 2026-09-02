import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const PROMPT_HEADINGS = {
  radical: '激进型上帝提示词',
  balanced: '普通型上帝提示词',
  conservative: '保守型上帝提示词',
};

function promptAfterHeading(markdown, heading) {
  const headingMarker = `## ${heading}`;
  const headingIndex = markdown.indexOf(headingMarker);
  if (headingIndex === -1) throw new Error(`god_prompt_heading_missing:${heading}`);

  const section = markdown.slice(headingIndex + headingMarker.length);
  const fence = section.match(/```(?:Plain)?\r?\n([\s\S]*?)\r?\n```/);
  if (!fence?.[1]?.trim()) throw new Error(`god_prompt_block_missing:${heading}`);
  return fence[1].trim();
}

export function parseGodPrompts(markdown) {
  return Object.fromEntries(
    Object.entries(PROMPT_HEADINGS).map(([godId, heading]) => [godId, promptAfterHeading(markdown, heading)]),
  );
}

export async function loadGodProfiles(gods, markdownPath) {
  const markdown = await readFile(markdownPath, 'utf8');
  const prompts = parseGodPrompts(markdown);

  return gods.map((god) => {
    const prompt = prompts[god.id];
    if (!prompt) throw new Error(`god_prompt_mapping_missing:${god.id}`);
    return {
      ...god,
      prompt,
      promptSource: 'god.md',
      promptHash: createHash('sha256').update(prompt).digest('hex'),
    };
  });
}

