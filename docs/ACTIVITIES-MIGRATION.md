# Activities migration and rollback

## Scope

Migration 9 transitions compatible legacy Live resources to slide-based Activities without deleting or rewriting legacy tables. The public slug and `live_activities.id` remain unchanged. Historical `live_participants`, `live_responses`, and `live_views` rows remain authoritative and available through the legacy administration route.

## Backup

Before migration 9 runs in production, ShortSwitch creates a consistent SQLite snapshot using `VACUUM INTO`:

```text
${DATABASE_PATH}.pre-legacy-live-v9.bak
```

It is created only when a legacy database exists, migration 9 is not recorded, and the backup does not already exist. Startup stops if backup creation fails. The Docker volume therefore needs enough free space for a second database copy.

For an additional operator-controlled backup, stop the application before copying the volume:

```bash
docker compose stop shortswitch
docker run --rm -v shortswitch-data:/data -v "$PWD:/backup" alpine \
  sh -c 'cp /data/shortswitch.db /backup/shortswitch-before-activities.db'
docker compose up -d shortswitch
```

Adjust the volume and database names to the deployment. Do not copy only the main database while ShortSwitch is writing to it.

## Mapping

| Legacy Live value | Activities value |
|---|---|
| Resource ID and slug | Same ID and root public URL |
| Active / closed | Published / disabled access |
| Anonymous / named | Same identification mode |
| Multiple Choice, one selection | Ungraded Single Choice |
| Multiple Choice, multiple selections | Ungraded Multiple Choice |
| Word Cloud | Ungraded Word Cloud |
| Multiple-response limit | Maximum attempts and Word Cloud response limit, clamped to supported bounds |
| Moderation mode | Word Cloud moderation mode |
| Public results | Activity and Word Cloud result visibility |
| Expiration | UTC global submission deadline |

Multiple Choice is deliberately ungraded because legacy Live stored no answer key. The migration never guesses correct options or historical scores. Existing option IDs are retained.

Legacy Open Answer and Scale remain on the legacy runtime in this release. Converting them automatically would change response or grading semantics. Malformed and multi-question records also remain legacy.

## Idempotency and audit

`legacy_activity_migrations` records one result per resource:

- `migrated` — an immutable Activities version and editable draft were created;
- `unsupported` — the resource stays on the legacy runtime with a reason;
- `error` — the per-resource transaction was rolled back and may be retried on a later startup.

Rows contain pre-migration response/view counts and the generated version ID. Repeat runs do not create duplicate models or versions. Automated tests compare counts and run `PRAGMA foreign_key_check`.

## Compatibility

- Existing `/:slug` URLs do not change.
- Migrated resources use the Activities player at the same URL.
- Unsupported resources continue using legacy Live.
- Migrated cards expose **Legacy results**.
- Legacy API routes and tables remain in this release.
- Pages keep the same `live_activity` resource ID and slug.

## Rollback

Application rollback requires the pre-migration database backup:

1. Stop ShortSwitch.
2. Preserve the post-migration database separately.
3. Replace it with `.pre-legacy-live-v9.bak`.
4. Start the previous image.
5. Verify `/api/health`, legacy public slugs, Links and Pages.

Do not manually delete Activities tables or migration rows. Attempts created after migration exist only in the post-migration database and are not present after restoring the backup.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run verify:production
npm run load:activities:50
npm run load:activities:200
npm run load:activities:500
```

Load scripts use temporary databases and fictional participants. Never point them at production.
