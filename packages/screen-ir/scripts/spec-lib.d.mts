// Types for spec-lib.mjs, for the tests that import it.

export declare const REPO: string;
export declare const SPEC_PATHS: readonly string[];
export declare const RELEASE_TAG: RegExp;

export declare class SpecError extends Error {}

export declare function assertReleaseTag(tag: string): void;
export declare function withCheckout<T>(tag: string, fn: (dir: string, commit: string) => T): T;
export declare function gitFiles(dir: string, paths: readonly string[]): string[];
export declare function walkFiles(root: string): string[];
export declare function hashFiles(root: string, files: readonly string[]): Record<string, string>;
export declare function readWidgetIds(specRoot: string): string[];
export declare function widgetIdent(id: string): string;
export declare function widgetsModuleSource(ids: readonly string[]): string;
export declare function applySpec(options: {
  checkoutDir: string;
  commit: string;
  tag: string;
  pkgDir: string;
}): Record<string, string>;
