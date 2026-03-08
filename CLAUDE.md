## Rules

- Use TDD. Write failing tests first, then write the code to make the tests pass.
- Always update ARCHITECTURE.md on every change. Architecture must be up to date with the codebase.
- Never speculate on code you have not opened. You must read the file before hand.
- Never make any claims about code before investigating. Ensure your claims are true.
- Make every task and code change that you do as simple as possible. Do not over-engineer solutions.
- Refer to MVP.md for the project structure. Always make changes with MVP.md in mind.
- Every step of the way give me a high level explaination of what changed.
- Ensure each file has one responsibility. If a file has more than one responsibility, refactor it into smaller files.


### Kuzu Database Connection Rule
Kuzu is an embedded graph database that enforces a strict, exclusive file lock on its data directory. 

- **NEVER** call `init_kuzu()` inside a FastAPI route handler or a frequently called function. If you do, Kuzu will throw an `IO exception: Could not set lock on file` and crash the server on the second request.
- **ALWAYS** use `get_db_connection()` to get a connection to the database. This function will return a fresh connection per request, and close it when done.