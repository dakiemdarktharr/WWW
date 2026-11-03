import type { AfterPackContext } from 'app-builder-lib';

export declare function extractNsisUninstaller(
  installerPath: string,
  uninstallerPath: string,
): Promise<void>;

export declare function configureLinuxNsisExtraction(context: AfterPackContext): void;
