// Shared type for Claude SDK permissionMode option.
// 'bypassPermissions' — no permission prompts (default)
// 'plan'             — Claude shows a plan and waits for approval before executing
export type PermissionMode = 'bypassPermissions' | 'plan'
