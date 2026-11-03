export const KNOWN_CONFLICTS = {
    dock: [
        {uuid: 'ubuntu-dock@ubuntu.com', name: 'Ubuntu Dock'},
    ],
    tiling: [
        {uuid: 'tiling-assistant@ubuntu.com', name: 'Tiling Assistant'},
    ],
};

export function findActiveConflicts(moduleId, lookup) {
    const entries = KNOWN_CONFLICTS[moduleId] ?? [];
    return entries.filter(entry => lookup(entry.uuid)?.state === 1);
}

export function conflictDetail(conflicts) {
    return conflicts.map(conflict => conflict.name).join(', ');
}
