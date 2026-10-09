# Command catalog controls

The catalog and workout picker initially show four rows: 12 items below 600 px and 16 at wider viewports. Expanding/collapsing and viewport changes affect presentation only; selected results remain in the workout draft. The picker reports the selected count and uses bordered buttons with aria-pressed, fill and a checkmark.

Delete requires confirmation naming the command. All commands are archived rather than physically deleted, including unused ones. The archived boolean defaults to false. Existing workout results, command identifiers, legacy sessions and immutable diary entries remain intact. Archived commands are excluded from the active catalog and new workout selection, but remain available when editing a workout that already used them. The archive section allows history inspection and restoring a command.

Database load includes archived; save retains the existing flag when an older client omits it. An omitted command is archived instead of cascade-deleted. Existing membership authorization and revision-conflict checks remain in force; owner and editor may edit, revoked/nonmembers cannot. Read-only UI disables editing and leaves history browsing available.

Verification includes database tests for history preservation, old clients, editing historical scores and revoked access; component tests for collapsed selection/read-only; browser interactions at 320/390/768 px for collapse, resize, selection persistence, save, cancellation, archive and history editing. Production data is compared by checksums before and after migration; no real commands are archived for testing.
