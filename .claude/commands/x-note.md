# x-note

Write structured, topic-organized notes to the notes-shilo MCP server.

## Usage
`/x-note [optional: what to write or which topic]`

If no argument is given, ask the user what to write.

## How to find the available tools

Use ToolSearch with query `"select:notes-shilo"` or just `"notes"` to discover the available MCP tools from the `notes-shilo` server. Common tool names might be:
- `notes-shilo__create_note` / `notes-shilo__add_note`
- `notes-shilo__list_notes` / `notes-shilo__get_notes`
- `notes-shilo__update_note` / `notes-shilo__delete_note`

Always run ToolSearch first to see the actual tool names before calling them.

## Steps

1. **Discover tools**: Run `ToolSearch` with query `"notes"` to find the exact tool names from `notes-shilo`.

2. **List existing notes/topics**: Call the list tool to see what's already there and avoid duplicates.

3. **Determine structure**: Organize content by topic. Each topic becomes a top-level note or section. Sub-items are issues/tasks/ideas under that topic.

4. **Write notes**: Use the create/write/upsert tool for each topic. Pass well-structured content.

5. **Confirm**: Report back what was written and under which topic.

## Organizational structure for yeshiva-attendance issues

When uploading issues from the codebase audit, organize by these topics (matching the Notion dashboard):

| נושא | תיאור |
|------|--------|
| יציאות והתראות | Push notifications, departure flow, quota |
| Auth והרשאות | PIN sessions, RLS, security |
| UX ומשוב משתמש | Validation, history view, user feedback |
| שגיאות ואמינות | Offline sync, realtime, dead-letter |
| תחזוקה וניקוי נתונים | DB schema, orphan tables, type mismatches |
| Dashboard ונתונים | Stats display, calendar view |
| ביקורת פנימית | RollCall results, audit log |

## Format per note/topic

```
# [Topic name in Hebrew]

## [Issue title]
- **עדיפות**: קריטי / גבוה / בינוני / נמוך
- **קבצים**: [file paths]
- **תיאור**: [what the problem is]
- **פתרון**: [suggested fix]

## [Next issue...]
```

## Notes

- Always append to existing content — never overwrite unless explicitly told to
- Use Hebrew for topic names and issue titles
- Keep issues concise — title + priority + files + one-line fix
