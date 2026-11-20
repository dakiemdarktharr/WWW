export const sharedSadeCloudFinishPath = '/api/cloud/shared-sade/finish';
export const sharedSadeCloudHeader = 'x-relay-cloud-sade';
export const sharedSadeCloudExtended = '2';

export type SharedSadeChoiceQuestion = {
  name: string;
  instructions: string;
  choices: readonly { value: string; description?: string }[];
};
