---
description: Performs thorough code review with focus on bugs, security, and best practices
allowed_tools: Read, Glob, Grep, Bash(git diff*), Bash(git log*)
---

# Code Review Skill

Review the provided code or files following these steps:

1. **Security**: Check for injection vulnerabilities (SQL, XSS, command), hardcoded secrets, improper auth
2. **Bugs**: Look for null references, race conditions, off-by-one errors, unhandled edge cases
3. **Performance**: Identify N+1 queries, unnecessary loops, missing indexes, memory leaks
4. **Best Practices**: Verify SOLID principles, proper error handling, consistent naming
5. **Architecture**: Evaluate separation of concerns, coupling, and cohesion

Output format:
- List issues by severity (Critical > High > Medium > Low)
- Include file path and line number for each issue
- Suggest specific fixes with code examples
