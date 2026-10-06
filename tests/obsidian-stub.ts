// Runtime boundary for service integration tests; task logic uses the real implementation.
export class TFile {
	constructor(public path: string) {}
	extension = 'md';
}
