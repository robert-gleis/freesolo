export function buildCandidateBranchName(issueNumber: number, slug: string): string {
  return `candidate/${issueNumber}-${slug}`;
}
