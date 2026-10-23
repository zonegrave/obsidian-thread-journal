// Runtime boundary for service integration tests; task logic uses the real implementation.
export class TFile {
	constructor(public path: string) {}
	extension = 'md';
}

export function setIcon(): void {}

export { parse as parseYaml } from 'yaml';
export function getFrontMatterInfo(text: string): { exists: boolean; frontmatter: string } {
 const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/u.exec(text);
 return { exists: Boolean(match), frontmatter: match?.[1] ?? '' };
}
