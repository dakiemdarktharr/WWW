'use strict';
const path = require('node:path');
const { createHash } = require('node:crypto');

// Legacy paths stay stable for their recorded owner (Git worktrees contain
// absolute paths). Everyone else gets a separate database, profiles and links.
function workspaceDirectory(root, ownerId, legacyOwner) {
  if (!ownerId) return path.join(root, 'signed-out');
  if (ownerId === legacyOwner) return path.join(root, 'workspace');
  const key = createHash('sha256').update(ownerId).digest('hex');
  return path.join(root, 'users', key, 'workspace');
}
module.exports = { workspaceDirectory };
