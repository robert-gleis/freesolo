import { z } from 'zod';

export const childIssueSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  labels: z.array(z.string().min(1))
});

export const decompositionPlanSchema = z.object({
  parent_issue: z.number().int().positive(),
  children: z.array(childIssueSchema).min(1)
});

export type ChildIssue = z.infer<typeof childIssueSchema>;
export type DecompositionPlan = z.infer<typeof decompositionPlanSchema>;
