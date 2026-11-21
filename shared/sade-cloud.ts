export const sharedSadeCloudFinishPath = '/api/cloud/shared-sade/finish';
export const sharedSadeCloudHeader = 'x-relay-cloud-sade';
export const sharedSadeCloudExtended = '2';
export const sharedSadeProjectPreparationBudgetMs = 12_000;
export const sharedSadeProjectRoadmapBudgetMs = 19_000;

export type SharedSadeChoiceQuestion = {
  name: string;
  instructions: string;
  choices: readonly { value: string; description?: string }[];
};
