export const WORKSPACE_BASE_WIDTH = 1360;
export const WORKSPACE_BASE_HEIGHT = 860;

export function computeWorkspaceScale(viewportWidth: number, viewportHeight: number): number {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return 1;
  }

  return Math.min(viewportWidth / WORKSPACE_BASE_WIDTH, viewportHeight / WORKSPACE_BASE_HEIGHT, 1);
}
