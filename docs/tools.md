# Tool Contracts

Generated from `src/tools/contracts`. Do not hand-edit tool schemas here; run `npm run generate:tools`.

Recommended first calls:

tool: workspace.context
```json tool=workspace.context
{}
```
tool: workspace.scan
```json tool=workspace.scan
{
  "maxDepth": 6,
  "maxEntries": 2000
}
```
tool: fs.tree
```json tool=fs.tree
{
  "path": ".",
  "maxDepth": 3,
  "maxEntries": 500
}
```
tool: fs.read_many
```json tool=fs.read_many
{
  "paths": [
    "README.md",
    "package.json"
  ],
  "maxBytes": 60000
}
```

## workspace.context

Returns the current policy, tool surface, host constraints, project/task summaries, and first-call guidance.

Modes: read-only, dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {},
  "required": [],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ok"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "truncated": {
      "type": "boolean"
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "toolSurface": {
      "type": "object",
      "properties": {
        "version": {
          "type": "string"
        },
        "hash": {
          "type": "string"
        },
        "tools": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "version",
        "hash",
        "tools"
      ],
      "additionalProperties": false
    },
    "policy": {
      "type": "object",
      "properties": {
        "profile": {
          "type": "string"
        },
        "hash": {
          "type": "string"
        },
        "effectiveLimits": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "profile",
        "hash",
        "effectiveLimits"
      ],
      "additionalProperties": false
    },
    "editMode": {
      "type": "object",
      "properties": {
        "mode": {
          "type": "string",
          "enum": [
            "single",
            "batch"
          ]
        },
        "batchEnabled": {
          "type": "boolean"
        }
      },
      "required": [
        "mode",
        "batchEnabled"
      ],
      "additionalProperties": false
    },
    "validFor": {
      "type": "object",
      "additionalProperties": true
    },
    "workspace": {
      "type": "object",
      "additionalProperties": true
    },
    "capabilities": {
      "type": "object",
      "additionalProperties": true
    },
    "hostConstraints": {
      "type": "object",
      "additionalProperties": true
    },
    "hostRiskProfile": {
      "type": "object",
      "additionalProperties": true
    },
    "project": {
      "type": "object",
      "additionalProperties": true
    },
    "git": {
      "type": "object",
      "additionalProperties": true
    },
    "tasks": {
      "type": "object",
      "additionalProperties": true
    },
    "manualFallback": {
      "type": "object",
      "additionalProperties": true
    },
    "upstreams": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "warnings": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "toolGuidance": {
      "type": "object",
      "properties": {
        "recommendedFirstCalls": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "tool": {
                "type": "string"
              },
              "args": {
                "type": "object",
                "additionalProperties": true
              }
            },
            "required": [
              "tool",
              "args"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "recommendedFirstCalls"
      ],
      "additionalProperties": false
    },
    "next": {
      "type": "object",
      "properties": {
        "tool": {
          "type": "string"
        },
        "reason": {
          "type": "string"
        },
        "alternatives": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "args": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "tool",
        "reason"
      ],
      "additionalProperties": true
    }
  },
  "required": [
    "status",
    "hostRisk",
    "truncated",
    "nextCursor",
    "toolSurface",
    "policy",
    "editMode",
    "validFor",
    "workspace",
    "capabilities",
    "hostConstraints",
    "hostRiskProfile",
    "project",
    "git",
    "tasks",
    "manualFallback",
    "upstreams",
    "warnings",
    "toolGuidance",
    "next"
  ],
  "additionalProperties": false
}
```

Examples:

- preflight
tool: workspace.context
```json tool=workspace.context
{}
```

## workspace.scan

Scans manifests, task/config files, frontend/codegen/database markers, and workspace candidates with explicit effective options.

Modes: read-only, dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {
    "maxDepth": {
      "type": "integer",
      "minimum": 0,
      "maximum": 12
    },
    "maxEntries": {
      "type": "integer",
      "minimum": 1,
      "maximum": 5000
    },
    "includeManifests": {
      "type": "boolean"
    },
    "includeTaskFiles": {
      "type": "boolean"
    },
    "includeConfigFiles": {
      "type": "boolean"
    },
    "includeScripts": {
      "type": "boolean"
    },
    "includeFrontend": {
      "type": "boolean"
    },
    "includeCodegen": {
      "type": "boolean"
    },
    "includeDatabase": {
      "type": "boolean"
    },
    "includeWorkspaceCandidates": {
      "type": "boolean"
    }
  },
  "required": [],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ok"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "root": {
      "type": "string",
      "enum": [
        "."
      ]
    },
    "project": {
      "type": "object",
      "additionalProperties": true
    },
    "packageManagers": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "languages": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "frontend": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "kind": {
            "type": "string"
          }
        },
        "required": [
          "path",
          "kind"
        ],
        "additionalProperties": false
      }
    },
    "codegen": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "kind": {
            "type": "string"
          }
        },
        "required": [
          "path",
          "kind"
        ],
        "additionalProperties": false
      }
    },
    "taskFiles": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "kind": {
            "type": "string"
          }
        },
        "required": [
          "path",
          "kind"
        ],
        "additionalProperties": false
      }
    },
    "database": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "kind": {
            "type": "string"
          }
        },
        "required": [
          "path",
          "kind"
        ],
        "additionalProperties": false
      }
    },
    "workspaceCandidates": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "truncated": {
      "type": "boolean"
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "effectiveOptions": {
      "type": "object",
      "properties": {
        "maxDepth": {
          "type": "integer",
          "minimum": 0
        },
        "maxEntries": {
          "type": "integer",
          "minimum": 1
        },
        "includeManifests": {
          "type": "boolean"
        },
        "includeTaskFiles": {
          "type": "boolean"
        },
        "includeConfigFiles": {
          "type": "boolean"
        },
        "includeScripts": {
          "type": "boolean"
        },
        "includeFrontend": {
          "type": "boolean"
        },
        "includeCodegen": {
          "type": "boolean"
        },
        "includeDatabase": {
          "type": "boolean"
        },
        "includeWorkspaceCandidates": {
          "type": "boolean"
        }
      },
      "required": [
        "maxDepth",
        "maxEntries",
        "includeManifests",
        "includeTaskFiles",
        "includeConfigFiles",
        "includeScripts",
        "includeFrontend",
        "includeCodegen",
        "includeDatabase",
        "includeWorkspaceCandidates"
      ],
      "additionalProperties": false
    },
    "next": {
      "type": "object",
      "properties": {
        "tool": {
          "type": "string",
          "enum": [
            "task.list"
          ]
        },
        "reason": {
          "type": "string"
        }
      },
      "required": [
        "tool",
        "reason"
      ],
      "additionalProperties": false
    }
  },
  "required": [
    "status",
    "hostRisk",
    "root",
    "project",
    "packageManagers",
    "languages",
    "frontend",
    "codegen",
    "taskFiles",
    "database",
    "workspaceCandidates",
    "truncated",
    "nextCursor",
    "effectiveOptions",
    "next"
  ],
  "additionalProperties": false
}
```

Examples:

- scan current workspace
tool: workspace.scan
```json tool=workspace.scan
{
  "maxDepth": 6,
  "maxEntries": 2000,
  "includeManifests": true,
  "includeTaskFiles": true,
  "includeConfigFiles": true,
  "includeScripts": true
}
```

## workspace.symbols

Returns lightweight TypeScript/JavaScript declarations and imports for bounded symbol discovery.

Modes: read-only, dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string"
    },
    "path": {
      "type": "string"
    },
    "kind": {
      "type": "string",
      "enum": [
        "class",
        "function",
        "method",
        "type",
        "interface",
        "const",
        "enum",
        "import"
      ]
    },
    "cursor": {
      "type": "string"
    },
    "maxResults": {
      "type": "integer",
      "minimum": 1,
      "maximum": 1000
    }
  },
  "required": [],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ok"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "symbols": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "kind": {
            "type": "string",
            "enum": [
              "class",
              "function",
              "method",
              "type",
              "interface",
              "const",
              "enum",
              "import"
            ]
          },
          "path": {
            "type": "string"
          },
          "line": {
            "type": "integer",
            "minimum": 1
          },
          "exported": {
            "type": "boolean"
          }
        },
        "required": [
          "name",
          "kind",
          "path",
          "line",
          "exported"
        ],
        "additionalProperties": false
      }
    },
    "imports": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "source": {
            "type": "string"
          },
          "line": {
            "type": "integer",
            "minimum": 1
          }
        },
        "required": [
          "path",
          "source",
          "line"
        ],
        "additionalProperties": false
      }
    },
    "truncated": {
      "type": "boolean"
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "status",
    "hostRisk",
    "symbols",
    "imports",
    "truncated",
    "nextCursor"
  ],
  "additionalProperties": false
}
```

Examples:

- find router symbols
tool: workspace.symbols
```json tool=workspace.symbols
{
  "path": "src/router/tools-call.ts",
  "maxResults": 50
}
```

## fs.tree

Lists files and directories with maxDepth, maxEntries, include/exclude, hidden, ignored, and cursor controls.

Modes: read-only, dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string"
    },
    "mode": {
      "type": "string",
      "enum": [
        "all",
        "files",
        "dirs",
        "packages",
        "git-tracked"
      ]
    },
    "include": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "exclude": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "respectGitignore": {
      "type": "boolean"
    },
    "includeHidden": {
      "type": "boolean"
    },
    "includeIgnored": {
      "type": "boolean"
    },
    "maxDepth": {
      "type": "integer",
      "minimum": 0,
      "maximum": 12
    },
    "maxEntries": {
      "type": "integer",
      "minimum": 1,
      "maximum": 5000
    },
    "cursor": {
      "type": "string"
    }
  },
  "required": [],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ok"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "root": {
      "type": "string"
    },
    "entries": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "type": {
            "type": "string",
            "enum": [
              "directory",
              "file",
              "symlink",
              "other"
            ]
          },
          "size": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [
          "path",
          "type"
        ],
        "additionalProperties": false
      }
    },
    "skipped": {
      "type": "object",
      "properties": {
        "protected": {
          "type": "integer",
          "minimum": 0
        },
        "missing": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "protected",
        "missing"
      ],
      "additionalProperties": false
    },
    "stats": {
      "type": "object",
      "properties": {
        "filesSeen": {
          "type": "integer",
          "minimum": 0
        },
        "dirsSeen": {
          "type": "integer",
          "minimum": 0
        },
        "protectedSkipped": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "filesSeen",
        "dirsSeen",
        "protectedSkipped"
      ],
      "additionalProperties": false
    },
    "omitted": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "reason": {
            "type": "string"
          }
        },
        "required": [
          "path",
          "reason"
        ],
        "additionalProperties": false
      }
    },
    "truncated": {
      "type": "boolean"
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "effectiveOptions": {
      "type": "object",
      "properties": {
        "mode": {
          "type": "string",
          "enum": [
            "all",
            "files",
            "dirs",
            "packages",
            "git-tracked"
          ]
        },
        "include": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "exclude": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "respectGitignore": {
          "type": "boolean"
        },
        "includeHidden": {
          "type": "boolean"
        },
        "includeIgnored": {
          "type": "boolean"
        },
        "maxDepth": {
          "type": "integer",
          "minimum": 0
        },
        "maxEntries": {
          "type": "integer",
          "minimum": 1
        },
        "cursorOffset": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "mode",
        "include",
        "exclude",
        "respectGitignore",
        "includeHidden",
        "includeIgnored",
        "maxDepth",
        "maxEntries",
        "cursorOffset"
      ],
      "additionalProperties": false
    }
  },
  "required": [
    "status",
    "hostRisk",
    "root",
    "entries",
    "skipped",
    "stats",
    "omitted",
    "truncated",
    "nextCursor",
    "effectiveOptions"
  ],
  "additionalProperties": false
}
```

Examples:

- tree root
tool: fs.tree
```json tool=fs.tree
{
  "path": ".",
  "maxDepth": 3,
  "maxEntries": 500
}
```

## fs.search

Searches text with fixed or regex mode, include/exclude globs, context lines, and gitignore/hidden/ignored controls.

Modes: read-only, dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500
    },
    "mode": {
      "type": "string",
      "enum": [
        "fixed",
        "regex"
      ]
    },
    "path": {
      "type": "string"
    },
    "include": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "exclude": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "case": {
      "type": "string",
      "enum": [
        "smart",
        "sensitive",
        "insensitive"
      ]
    },
    "contextLines": {
      "type": "integer",
      "minimum": 0,
      "maximum": 5
    },
    "maxResults": {
      "type": "integer",
      "minimum": 1,
      "maximum": 1000
    },
    "maxColumns": {
      "type": "integer",
      "minimum": 1,
      "maximum": 300
    },
    "respectGitignore": {
      "type": "boolean"
    },
    "includeHidden": {
      "type": "boolean"
    },
    "includeIgnored": {
      "type": "boolean"
    },
    "cursor": {
      "type": "string"
    }
  },
  "required": [
    "query"
  ],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ok"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "query": {
      "type": "string"
    },
    "mode": {
      "type": "string",
      "enum": [
        "fixed",
        "regex"
      ]
    },
    "case": {
      "type": "string",
      "enum": [
        "smart",
        "sensitive",
        "insensitive"
      ]
    },
    "matches": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "line": {
            "type": "integer",
            "minimum": 1
          },
          "column": {
            "type": "integer",
            "minimum": 1
          },
          "text": {
            "type": "string"
          },
          "submatches": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "start": {
                  "type": "integer",
                  "minimum": 0
                },
                "end": {
                  "type": "integer",
                  "minimum": 0
                }
              },
              "required": [
                "start",
                "end"
              ],
              "additionalProperties": false
            }
          },
          "before": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "after": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "path",
          "line",
          "column",
          "text",
          "submatches",
          "before",
          "after"
        ],
        "additionalProperties": false
      }
    },
    "searchedFiles": {
      "type": "integer",
      "minimum": 0
    },
    "skipped": {
      "type": "object",
      "properties": {
        "protected": {
          "type": "integer",
          "minimum": 0
        },
        "binary": {
          "type": "integer",
          "minimum": 0
        },
        "tooLarge": {
          "type": "integer",
          "minimum": 0
        },
        "missing": {
          "type": "integer",
          "minimum": 0
        },
        "permissionDenied": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "protected",
        "binary",
        "tooLarge",
        "missing"
      ],
      "additionalProperties": false
    },
    "truncated": {
      "type": "boolean"
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "engine": {
      "type": "string",
      "enum": [
        "rg",
        "js"
      ]
    },
    "effectiveOptions": {
      "type": "object",
      "properties": {
        "mode": {
          "type": "string",
          "enum": [
            "fixed",
            "regex"
          ]
        },
        "case": {
          "type": "string",
          "enum": [
            "smart",
            "sensitive",
            "insensitive"
          ]
        },
        "caseSensitive": {
          "type": "boolean"
        },
        "include": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "exclude": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "contextLines": {
          "type": "integer",
          "minimum": 0
        },
        "maxColumns": {
          "type": "integer",
          "minimum": 1
        },
        "maxResults": {
          "type": "integer",
          "minimum": 1
        },
        "cursorOffset": {
          "type": "integer",
          "minimum": 0
        },
        "respectGitignore": {
          "type": "boolean"
        },
        "includeHidden": {
          "type": "boolean"
        },
        "includeIgnored": {
          "type": "boolean"
        }
      },
      "required": [
        "mode",
        "case",
        "caseSensitive",
        "include",
        "exclude",
        "contextLines",
        "maxColumns",
        "maxResults",
        "cursorOffset",
        "respectGitignore",
        "includeHidden",
        "includeIgnored"
      ],
      "additionalProperties": false
    }
  },
  "required": [
    "status",
    "hostRisk",
    "query",
    "mode",
    "case",
    "matches",
    "searchedFiles",
    "skipped",
    "truncated",
    "nextCursor",
    "engine",
    "effectiveOptions"
  ],
  "additionalProperties": false
}
```

Examples:

- search source
tool: fs.search
```json tool=fs.search
{
  "query": "ToolRouter",
  "path": "src",
  "maxResults": 20
}
```

## fs.read

Reads one file by byteOffset or line range. Use nextOffsetBytes as byteOffset for continuation.

Modes: read-only, dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string"
    },
    "byteOffset": {
      "type": "integer",
      "minimum": 0
    },
    "range": {
      "type": "object",
      "properties": {
        "startLine": {
          "type": "integer",
          "minimum": 1
        },
        "endLine": {
          "type": "integer",
          "minimum": 1
        }
      },
      "required": [
        "startLine",
        "endLine"
      ],
      "additionalProperties": false
    },
    "maxBytes": {
      "type": "integer",
      "minimum": 1,
      "maximum": 131072
    },
    "format": {
      "type": "string",
      "enum": [
        "content",
        "lines"
      ]
    }
  },
  "required": [
    "path"
  ],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ok"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "exists": {
            "type": "boolean"
          },
          "type": {
            "type": "string",
            "enum": [
              "file",
              "directory",
              "symlink",
              "other"
            ]
          },
          "kind": {
            "type": "string",
            "enum": [
              "text",
              "binary"
            ]
          },
          "size": {
            "type": "integer",
            "minimum": 0
          },
          "sha256": {
            "type": "string"
          },
          "offsetBytes": {
            "type": "integer",
            "minimum": 0
          },
          "returnedBytes": {
            "type": "integer",
            "minimum": 0
          },
          "nextOffsetBytes": {
            "type": "integer",
            "minimum": 0
          },
          "returnedLines": {
            "type": "integer",
            "minimum": 0
          },
          "format": {
            "type": "string",
            "enum": [
              "content",
              "lines"
            ]
          },
          "range": {
            "type": "object",
            "properties": {
              "startLine": {
                "type": "integer",
                "minimum": 1
              },
              "endLine": {
                "type": "integer",
                "minimum": 1
              }
            },
            "required": [
              "startLine",
              "endLine"
            ],
            "additionalProperties": false
          },
          "content": {
            "type": "string"
          },
          "lines": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "line": {
                  "type": "integer",
                  "minimum": 1
                },
                "text": {
                  "type": "string"
                }
              },
              "required": [
                "line",
                "text"
              ],
              "additionalProperties": false
            }
          },
          "truncated": {
            "type": "boolean"
          },
          "error": {
            "type": "string"
          }
        },
        "required": [
          "path",
          "exists"
        ],
        "additionalProperties": false
      }
    },
    "effectiveOptions": {
      "type": "object",
      "additionalProperties": true
    }
  },
  "required": [
    "status",
    "hostRisk",
    "files",
    "effectiveOptions"
  ],
  "additionalProperties": false
}
```

Examples:

- read file
tool: fs.read
```json tool=fs.read
{
  "path": "README.md",
  "maxBytes": 60000
}
```

## fs.read_many

Reads several files either with simple paths plus shared options or advanced per-file options.

Modes: read-only, dev
Risk: low

Input schema:

```json
{
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "paths": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "minItems": 1,
          "maxItems": 50
        },
        "byteOffset": {
          "type": "integer",
          "minimum": 0
        },
        "range": {
          "type": "object",
          "properties": {
            "startLine": {
              "type": "integer",
              "minimum": 1
            },
            "endLine": {
              "type": "integer",
              "minimum": 1
            }
          },
          "required": [
            "startLine",
            "endLine"
          ],
          "additionalProperties": false
        },
        "maxBytes": {
          "type": "integer",
          "minimum": 1,
          "maximum": 131072
        },
        "format": {
          "type": "string",
          "enum": [
            "content",
            "lines"
          ]
        }
      },
      "required": [
        "paths"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "files": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "path": {
                "type": "string"
              },
              "byteOffset": {
                "type": "integer",
                "minimum": 0
              },
              "range": {
                "type": "object",
                "properties": {
                  "startLine": {
                    "type": "integer",
                    "minimum": 1
                  },
                  "endLine": {
                    "type": "integer",
                    "minimum": 1
                  }
                },
                "required": [
                  "startLine",
                  "endLine"
                ],
                "additionalProperties": false
              },
              "maxBytes": {
                "type": "integer",
                "minimum": 1,
                "maximum": 131072
              },
              "format": {
                "type": "string",
                "enum": [
                  "content",
                  "lines"
                ]
              }
            },
            "required": [
              "path"
            ],
            "additionalProperties": false
          },
          "minItems": 1,
          "maxItems": 50
        },
        "maxBytesPerFile": {
          "type": "integer",
          "minimum": 1,
          "maximum": 131072
        }
      },
      "required": [
        "files"
      ],
      "additionalProperties": false
    }
  ]
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ok"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "exists": {
            "type": "boolean"
          },
          "type": {
            "type": "string",
            "enum": [
              "file",
              "directory",
              "symlink",
              "other"
            ]
          },
          "kind": {
            "type": "string",
            "enum": [
              "text",
              "binary"
            ]
          },
          "size": {
            "type": "integer",
            "minimum": 0
          },
          "sha256": {
            "type": "string"
          },
          "offsetBytes": {
            "type": "integer",
            "minimum": 0
          },
          "returnedBytes": {
            "type": "integer",
            "minimum": 0
          },
          "nextOffsetBytes": {
            "type": "integer",
            "minimum": 0
          },
          "returnedLines": {
            "type": "integer",
            "minimum": 0
          },
          "format": {
            "type": "string",
            "enum": [
              "content",
              "lines"
            ]
          },
          "range": {
            "type": "object",
            "properties": {
              "startLine": {
                "type": "integer",
                "minimum": 1
              },
              "endLine": {
                "type": "integer",
                "minimum": 1
              }
            },
            "required": [
              "startLine",
              "endLine"
            ],
            "additionalProperties": false
          },
          "content": {
            "type": "string"
          },
          "lines": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "line": {
                  "type": "integer",
                  "minimum": 1
                },
                "text": {
                  "type": "string"
                }
              },
              "required": [
                "line",
                "text"
              ],
              "additionalProperties": false
            }
          },
          "truncated": {
            "type": "boolean"
          },
          "error": {
            "type": "string"
          }
        },
        "required": [
          "path",
          "exists"
        ],
        "additionalProperties": false
      }
    },
    "effectiveOptions": {
      "type": "object",
      "additionalProperties": true
    }
  },
  "required": [
    "status",
    "hostRisk",
    "files",
    "effectiveOptions"
  ],
  "additionalProperties": false
}
```

Examples:

- read common project files
tool: fs.read_many
```json tool=fs.read_many
{
  "paths": [
    "README.md",
    "package.json"
  ],
  "maxBytes": 60000
}
```

## fs.stat

Returns existence, type, size, hashes, and timestamps for up to 100 paths.

Modes: read-only, dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string"
    },
    "paths": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "minItems": 1,
      "maxItems": 100
    }
  },
  "required": [],
  "additionalProperties": false,
  "anyOf": [
    {
      "properties": {
        "path": {
          "type": "string"
        }
      },
      "required": [
        "path"
      ]
    },
    {
      "properties": {
        "paths": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "minItems": 1,
          "maxItems": 100
        }
      },
      "required": [
        "paths"
      ]
    }
  ]
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ok"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "exists": {
            "type": "boolean"
          },
          "type": {
            "type": "string",
            "enum": [
              "directory",
              "file",
              "symlink",
              "other"
            ]
          },
          "kind": {
            "type": "string",
            "enum": [
              "text",
              "binary"
            ]
          },
          "size": {
            "type": "integer",
            "minimum": 0
          },
          "sha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "modifiedAt": {
            "type": "string"
          },
          "createdAt": {
            "type": "string"
          }
        },
        "required": [
          "path",
          "exists"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "status",
    "hostRisk",
    "files"
  ],
  "additionalProperties": false
}
```

Examples:

- stat files
tool: fs.stat
```json tool=fs.stat
{
  "paths": [
    "package.json"
  ]
}
```

## fs.manifest

Returns hash-ready manifest entries using sizeBytes, mtimeMs, and sha256 for files.

Modes: read-only, dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {
    "paths": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "minItems": 1,
      "maxItems": 1000
    }
  },
  "required": [
    "paths"
  ],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ok"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "exists": {
            "type": "boolean"
          },
          "type": {
            "type": "string",
            "enum": [
              "file",
              "directory",
              "symlink",
              "other",
              "missing"
            ]
          },
          "sizeBytes": {
            "type": "integer",
            "minimum": 0
          },
          "mtimeMs": {
            "type": "number",
            "minimum": 0
          },
          "sha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          }
        },
        "required": [
          "path",
          "exists"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "status",
    "hostRisk",
    "files"
  ],
  "additionalProperties": false
}
```

Examples:

- manifest package
tool: fs.manifest
```json tool=fs.manifest
{
  "paths": [
    "package.json"
  ]
}
```

## file.change_preview

Previews exactly one logical file change and returns an envelope with preview data.

Modes: dev
Risk: medium

Input schema:

```json
{
  "type": "object",
  "properties": {
    "baseRevision": {
      "type": "string",
      "minLength": 1
    },
    "changes": {
      "type": "array",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "create"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "content": {
                "type": "string"
              }
            },
            "required": [
              "op",
              "path",
              "content"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "write"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "content": {
                "type": "string"
              },
              "mode": {
                "type": "string",
                "enum": [
                  "text"
                ]
              }
            },
            "required": [
              "op",
              "path",
              "content"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "replace"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "content": {
                "type": "string"
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "content"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "edit"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "edits": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "oldText": {
                      "type": "string",
                      "minLength": 1
                    },
                    "newText": {
                      "type": "string"
                    },
                    "replaceAll": {
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "oldText",
                    "newText"
                  ],
                  "additionalProperties": false
                },
                "minItems": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "edits"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "text_edit"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "edits": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "oldText": {
                      "type": "string",
                      "minLength": 1
                    },
                    "newText": {
                      "type": "string"
                    },
                    "replaceAll": {
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "oldText",
                    "newText"
                  ],
                  "additionalProperties": false
                },
                "minItems": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "edits"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "json_patch"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "patch": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "op": {
                      "type": "string",
                      "enum": [
                        "add",
                        "replace",
                        "remove"
                      ]
                    },
                    "path": {
                      "type": "string",
                      "minLength": 1
                    },
                    "value": true
                  },
                  "required": [
                    "op",
                    "path"
                  ],
                  "additionalProperties": false
                },
                "minItems": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "patch"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "unified_diff"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "diff": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "diff"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "delete"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "rename"
              },
              "from": {
                "type": "string",
                "minLength": 1
              },
              "to": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              }
            },
            "required": [
              "op",
              "from",
              "to",
              "expectedSha256"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "mkdir"
              },
              "path": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "op",
              "path"
            ],
            "additionalProperties": false
          }
        ]
      },
      "minItems": 1,
      "maxItems": 1
    }
  },
  "required": [
    "changes"
  ],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean"
    },
    "status": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "valid": {
          "type": "boolean"
        },
        "status": {
          "type": "string",
          "enum": [
            "ok",
            "conflicted"
          ]
        },
        "previewId": {
          "type": "string"
        },
        "baseRevision": {
          "type": "string"
        },
        "base": {
          "type": "object",
          "additionalProperties": true
        },
        "summary": {
          "type": "object",
          "additionalProperties": true
        },
        "files": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "diff": {
          "type": "string"
        },
        "diffInfo": {
          "type": "object",
          "additionalProperties": true
        },
        "conflicts": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "warnings": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "artifacts": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "previewHash": {
          "type": "string",
          "pattern": "^sha256:[a-f0-9]{64}$"
        },
        "changeHash": {
          "type": "string",
          "pattern": "^sha256:[a-f0-9]{64}$"
        },
        "hostRisk": {
          "type": "string",
          "enum": [
            "low",
            "medium",
            "high"
          ]
        },
        "risk": {
          "type": "object",
          "additionalProperties": true
        },
        "manualPlan": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "valid",
        "status",
        "previewId",
        "base",
        "summary",
        "files",
        "diff",
        "diffInfo",
        "conflicts",
        "warnings",
        "artifacts",
        "previewHash",
        "changeHash",
        "hostRisk",
        "risk"
      ],
      "additionalProperties": false
    },
    "warnings": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "limits": {
      "type": "object",
      "properties": {
        "requested": {
          "type": "object",
          "additionalProperties": true
        },
        "effective": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "requested",
        "effective"
      ],
      "additionalProperties": false
    },
    "truncated": {
      "type": "boolean"
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "artifacts": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    }
  },
  "required": [
    "ok",
    "status",
    "data",
    "warnings",
    "limits",
    "truncated",
    "nextCursor",
    "artifacts"
  ],
  "additionalProperties": false
}
```

Examples:

- preview text edit
tool: file.change_preview
```json tool=file.change_preview
{
  "changes": [
    {
      "op": "edit",
      "path": "README.md",
      "expectedSha256": "0000000000000000000000000000000000000000000000000000000000000000",
      "edits": [
        {
          "oldText": "old",
          "newText": "new"
        }
      ]
    }
  ]
}
```

## file.change_apply

Applies exactly one previously previewed logical file change with a matching previewHash.

Modes: dev
Risk: medium

Input schema:

```json
{
  "type": "object",
  "properties": {
    "baseRevision": {
      "type": "string",
      "minLength": 1
    },
    "previewHash": {
      "type": "string",
      "pattern": "^sha256:[a-f0-9]{64}$"
    },
    "changes": {
      "type": "array",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "create"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "content": {
                "type": "string"
              }
            },
            "required": [
              "op",
              "path",
              "content"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "write"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "content": {
                "type": "string"
              },
              "mode": {
                "type": "string",
                "enum": [
                  "text"
                ]
              }
            },
            "required": [
              "op",
              "path",
              "content"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "replace"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "content": {
                "type": "string"
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "content"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "edit"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "edits": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "oldText": {
                      "type": "string",
                      "minLength": 1
                    },
                    "newText": {
                      "type": "string"
                    },
                    "replaceAll": {
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "oldText",
                    "newText"
                  ],
                  "additionalProperties": false
                },
                "minItems": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "edits"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "text_edit"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "edits": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "oldText": {
                      "type": "string",
                      "minLength": 1
                    },
                    "newText": {
                      "type": "string"
                    },
                    "replaceAll": {
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "oldText",
                    "newText"
                  ],
                  "additionalProperties": false
                },
                "minItems": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "edits"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "json_patch"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "patch": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "op": {
                      "type": "string",
                      "enum": [
                        "add",
                        "replace",
                        "remove"
                      ]
                    },
                    "path": {
                      "type": "string",
                      "minLength": 1
                    },
                    "value": true
                  },
                  "required": [
                    "op",
                    "path"
                  ],
                  "additionalProperties": false
                },
                "minItems": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "patch"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "unified_diff"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "diff": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "diff"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "delete"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "rename"
              },
              "from": {
                "type": "string",
                "minLength": 1
              },
              "to": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              }
            },
            "required": [
              "op",
              "from",
              "to",
              "expectedSha256"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "mkdir"
              },
              "path": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "op",
              "path"
            ],
            "additionalProperties": false
          }
        ]
      },
      "minItems": 1,
      "maxItems": 1
    }
  },
  "required": [
    "previewHash",
    "changes"
  ],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "blocked"
      ]
    },
    "applied": {
      "type": "boolean"
    },
    "verified": {
      "type": "boolean"
    },
    "verification": {
      "type": "object",
      "additionalProperties": true
    },
    "baseRevision": {
      "type": "string"
    },
    "base": {
      "type": "object",
      "additionalProperties": true
    },
    "summary": {
      "type": "object",
      "additionalProperties": true
    },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "conflicts": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "previewHash": {
      "type": "string",
      "pattern": "^sha256:[a-f0-9]{64}$"
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "risk": {
      "type": "object",
      "additionalProperties": true
    },
    "manualPlan": {
      "type": "object",
      "additionalProperties": true
    }
  },
  "required": [
    "applied",
    "verified",
    "verification",
    "base",
    "summary",
    "files",
    "conflicts",
    "hostRisk",
    "risk"
  ],
  "additionalProperties": false
}
```

Examples:

- apply text edit
tool: file.change_apply
```json tool=file.change_apply
{
  "previewHash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "changes": [
    {
      "op": "edit",
      "path": "README.md",
      "expectedSha256": "0000000000000000000000000000000000000000000000000000000000000000",
      "edits": [
        {
          "oldText": "old",
          "newText": "new"
        }
      ]
    }
  ]
}
```

## batch.change_preview

Previews a policy-enabled batch changeset and returns an envelope with preview data.

Modes: dev
Risk: medium

Input schema:

```json
{
  "type": "object",
  "properties": {
    "baseRevision": {
      "type": "string",
      "minLength": 1
    },
    "changes": {
      "type": "array",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "create"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "content": {
                "type": "string"
              }
            },
            "required": [
              "op",
              "path",
              "content"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "write"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "content": {
                "type": "string"
              },
              "mode": {
                "type": "string",
                "enum": [
                  "text"
                ]
              }
            },
            "required": [
              "op",
              "path",
              "content"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "replace"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "content": {
                "type": "string"
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "content"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "edit"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "edits": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "oldText": {
                      "type": "string",
                      "minLength": 1
                    },
                    "newText": {
                      "type": "string"
                    },
                    "replaceAll": {
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "oldText",
                    "newText"
                  ],
                  "additionalProperties": false
                },
                "minItems": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "edits"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "text_edit"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "edits": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "oldText": {
                      "type": "string",
                      "minLength": 1
                    },
                    "newText": {
                      "type": "string"
                    },
                    "replaceAll": {
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "oldText",
                    "newText"
                  ],
                  "additionalProperties": false
                },
                "minItems": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "edits"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "json_patch"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "patch": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "op": {
                      "type": "string",
                      "enum": [
                        "add",
                        "replace",
                        "remove"
                      ]
                    },
                    "path": {
                      "type": "string",
                      "minLength": 1
                    },
                    "value": true
                  },
                  "required": [
                    "op",
                    "path"
                  ],
                  "additionalProperties": false
                },
                "minItems": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "patch"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "unified_diff"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "diff": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "diff"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "delete"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "rename"
              },
              "from": {
                "type": "string",
                "minLength": 1
              },
              "to": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              }
            },
            "required": [
              "op",
              "from",
              "to",
              "expectedSha256"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "mkdir"
              },
              "path": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "op",
              "path"
            ],
            "additionalProperties": false
          }
        ]
      },
      "minItems": 1
    }
  },
  "required": [
    "changes"
  ],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean"
    },
    "status": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "valid": {
          "type": "boolean"
        },
        "status": {
          "type": "string",
          "enum": [
            "ok",
            "conflicted"
          ]
        },
        "previewId": {
          "type": "string"
        },
        "baseRevision": {
          "type": "string"
        },
        "base": {
          "type": "object",
          "additionalProperties": true
        },
        "summary": {
          "type": "object",
          "additionalProperties": true
        },
        "files": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "diff": {
          "type": "string"
        },
        "diffInfo": {
          "type": "object",
          "additionalProperties": true
        },
        "conflicts": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "warnings": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "artifacts": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "previewHash": {
          "type": "string",
          "pattern": "^sha256:[a-f0-9]{64}$"
        },
        "changeHash": {
          "type": "string",
          "pattern": "^sha256:[a-f0-9]{64}$"
        },
        "hostRisk": {
          "type": "string",
          "enum": [
            "low",
            "medium",
            "high"
          ]
        },
        "risk": {
          "type": "object",
          "additionalProperties": true
        },
        "manualPlan": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "valid",
        "status",
        "previewId",
        "base",
        "summary",
        "files",
        "diff",
        "diffInfo",
        "conflicts",
        "warnings",
        "artifacts",
        "previewHash",
        "changeHash",
        "hostRisk",
        "risk"
      ],
      "additionalProperties": false
    },
    "warnings": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "limits": {
      "type": "object",
      "properties": {
        "requested": {
          "type": "object",
          "additionalProperties": true
        },
        "effective": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "requested",
        "effective"
      ],
      "additionalProperties": false
    },
    "truncated": {
      "type": "boolean"
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "artifacts": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    }
  },
  "required": [
    "ok",
    "status",
    "data",
    "warnings",
    "limits",
    "truncated",
    "nextCursor",
    "artifacts"
  ],
  "additionalProperties": false
}
```

Examples:

- preview text edit
tool: batch.change_preview
```json tool=batch.change_preview
{
  "changes": [
    {
      "op": "edit",
      "path": "README.md",
      "expectedSha256": "0000000000000000000000000000000000000000000000000000000000000000",
      "edits": [
        {
          "oldText": "old",
          "newText": "new"
        }
      ]
    }
  ]
}
```

## batch.change_apply

Applies a previously previewed batch changeset with a matching previewHash.

Modes: dev
Risk: medium

Input schema:

```json
{
  "type": "object",
  "properties": {
    "baseRevision": {
      "type": "string",
      "minLength": 1
    },
    "previewHash": {
      "type": "string",
      "pattern": "^sha256:[a-f0-9]{64}$"
    },
    "changes": {
      "type": "array",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "create"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "content": {
                "type": "string"
              }
            },
            "required": [
              "op",
              "path",
              "content"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "write"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "content": {
                "type": "string"
              },
              "mode": {
                "type": "string",
                "enum": [
                  "text"
                ]
              }
            },
            "required": [
              "op",
              "path",
              "content"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "replace"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "content": {
                "type": "string"
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "content"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "edit"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "edits": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "oldText": {
                      "type": "string",
                      "minLength": 1
                    },
                    "newText": {
                      "type": "string"
                    },
                    "replaceAll": {
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "oldText",
                    "newText"
                  ],
                  "additionalProperties": false
                },
                "minItems": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "edits"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "text_edit"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "edits": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "oldText": {
                      "type": "string",
                      "minLength": 1
                    },
                    "newText": {
                      "type": "string"
                    },
                    "replaceAll": {
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "oldText",
                    "newText"
                  ],
                  "additionalProperties": false
                },
                "minItems": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "edits"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "json_patch"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "patch": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "op": {
                      "type": "string",
                      "enum": [
                        "add",
                        "replace",
                        "remove"
                      ]
                    },
                    "path": {
                      "type": "string",
                      "minLength": 1
                    },
                    "value": true
                  },
                  "required": [
                    "op",
                    "path"
                  ],
                  "additionalProperties": false
                },
                "minItems": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "patch"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "unified_diff"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "diff": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "diff"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "delete"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "rename"
              },
              "from": {
                "type": "string",
                "minLength": 1
              },
              "to": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              }
            },
            "required": [
              "op",
              "from",
              "to",
              "expectedSha256"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "mkdir"
              },
              "path": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "op",
              "path"
            ],
            "additionalProperties": false
          }
        ]
      },
      "minItems": 1
    }
  },
  "required": [
    "previewHash",
    "changes"
  ],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "blocked"
      ]
    },
    "applied": {
      "type": "boolean"
    },
    "verified": {
      "type": "boolean"
    },
    "verification": {
      "type": "object",
      "additionalProperties": true
    },
    "baseRevision": {
      "type": "string"
    },
    "base": {
      "type": "object",
      "additionalProperties": true
    },
    "summary": {
      "type": "object",
      "additionalProperties": true
    },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "conflicts": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "previewHash": {
      "type": "string",
      "pattern": "^sha256:[a-f0-9]{64}$"
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "risk": {
      "type": "object",
      "additionalProperties": true
    },
    "manualPlan": {
      "type": "object",
      "additionalProperties": true
    }
  },
  "required": [
    "applied",
    "verified",
    "verification",
    "base",
    "summary",
    "files",
    "conflicts",
    "hostRisk",
    "risk"
  ],
  "additionalProperties": false
}
```

Examples:

- apply text edit
tool: batch.change_apply
```json tool=batch.change_apply
{
  "previewHash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "changes": [
    {
      "op": "edit",
      "path": "README.md",
      "expectedSha256": "0000000000000000000000000000000000000000000000000000000000000000",
      "edits": [
        {
          "oldText": "old",
          "newText": "new"
        }
      ]
    }
  ]
}
```

## change.preview

Previews a policy-enabled batch changeset and returns an envelope with preview data.

Modes: dev
Risk: medium

Input schema:

```json
{
  "type": "object",
  "properties": {
    "baseRevision": {
      "type": "string",
      "minLength": 1
    },
    "changes": {
      "type": "array",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "create"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "content": {
                "type": "string"
              }
            },
            "required": [
              "op",
              "path",
              "content"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "write"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "content": {
                "type": "string"
              },
              "mode": {
                "type": "string",
                "enum": [
                  "text"
                ]
              }
            },
            "required": [
              "op",
              "path",
              "content"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "replace"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "content": {
                "type": "string"
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "content"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "edit"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "edits": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "oldText": {
                      "type": "string",
                      "minLength": 1
                    },
                    "newText": {
                      "type": "string"
                    },
                    "replaceAll": {
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "oldText",
                    "newText"
                  ],
                  "additionalProperties": false
                },
                "minItems": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "edits"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "text_edit"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "edits": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "oldText": {
                      "type": "string",
                      "minLength": 1
                    },
                    "newText": {
                      "type": "string"
                    },
                    "replaceAll": {
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "oldText",
                    "newText"
                  ],
                  "additionalProperties": false
                },
                "minItems": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "edits"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "json_patch"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "patch": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "op": {
                      "type": "string",
                      "enum": [
                        "add",
                        "replace",
                        "remove"
                      ]
                    },
                    "path": {
                      "type": "string",
                      "minLength": 1
                    },
                    "value": true
                  },
                  "required": [
                    "op",
                    "path"
                  ],
                  "additionalProperties": false
                },
                "minItems": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "patch"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "unified_diff"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "diff": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "diff"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "delete"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "rename"
              },
              "from": {
                "type": "string",
                "minLength": 1
              },
              "to": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              }
            },
            "required": [
              "op",
              "from",
              "to",
              "expectedSha256"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "mkdir"
              },
              "path": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "op",
              "path"
            ],
            "additionalProperties": false
          }
        ]
      },
      "minItems": 1
    }
  },
  "required": [
    "changes"
  ],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean"
    },
    "status": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "valid": {
          "type": "boolean"
        },
        "status": {
          "type": "string",
          "enum": [
            "ok",
            "conflicted"
          ]
        },
        "previewId": {
          "type": "string"
        },
        "baseRevision": {
          "type": "string"
        },
        "base": {
          "type": "object",
          "additionalProperties": true
        },
        "summary": {
          "type": "object",
          "additionalProperties": true
        },
        "files": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "diff": {
          "type": "string"
        },
        "diffInfo": {
          "type": "object",
          "additionalProperties": true
        },
        "conflicts": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "warnings": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "artifacts": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "previewHash": {
          "type": "string",
          "pattern": "^sha256:[a-f0-9]{64}$"
        },
        "changeHash": {
          "type": "string",
          "pattern": "^sha256:[a-f0-9]{64}$"
        },
        "hostRisk": {
          "type": "string",
          "enum": [
            "low",
            "medium",
            "high"
          ]
        },
        "risk": {
          "type": "object",
          "additionalProperties": true
        },
        "manualPlan": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "valid",
        "status",
        "previewId",
        "base",
        "summary",
        "files",
        "diff",
        "diffInfo",
        "conflicts",
        "warnings",
        "artifacts",
        "previewHash",
        "changeHash",
        "hostRisk",
        "risk"
      ],
      "additionalProperties": false
    },
    "warnings": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "limits": {
      "type": "object",
      "properties": {
        "requested": {
          "type": "object",
          "additionalProperties": true
        },
        "effective": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "requested",
        "effective"
      ],
      "additionalProperties": false
    },
    "truncated": {
      "type": "boolean"
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "artifacts": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    }
  },
  "required": [
    "ok",
    "status",
    "data",
    "warnings",
    "limits",
    "truncated",
    "nextCursor",
    "artifacts"
  ],
  "additionalProperties": false
}
```

Examples:

- preview text edit
tool: change.preview
```json tool=change.preview
{
  "changes": [
    {
      "op": "edit",
      "path": "README.md",
      "expectedSha256": "0000000000000000000000000000000000000000000000000000000000000000",
      "edits": [
        {
          "oldText": "old",
          "newText": "new"
        }
      ]
    }
  ]
}
```

## change.apply

Applies a previously previewed batch changeset with a matching previewHash.

Modes: dev
Risk: medium

Input schema:

```json
{
  "type": "object",
  "properties": {
    "baseRevision": {
      "type": "string",
      "minLength": 1
    },
    "previewHash": {
      "type": "string",
      "pattern": "^sha256:[a-f0-9]{64}$"
    },
    "changes": {
      "type": "array",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "create"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "content": {
                "type": "string"
              }
            },
            "required": [
              "op",
              "path",
              "content"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "write"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "content": {
                "type": "string"
              },
              "mode": {
                "type": "string",
                "enum": [
                  "text"
                ]
              }
            },
            "required": [
              "op",
              "path",
              "content"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "replace"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "content": {
                "type": "string"
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "content"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "edit"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "edits": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "oldText": {
                      "type": "string",
                      "minLength": 1
                    },
                    "newText": {
                      "type": "string"
                    },
                    "replaceAll": {
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "oldText",
                    "newText"
                  ],
                  "additionalProperties": false
                },
                "minItems": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "edits"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "text_edit"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "edits": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "oldText": {
                      "type": "string",
                      "minLength": 1
                    },
                    "newText": {
                      "type": "string"
                    },
                    "replaceAll": {
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "oldText",
                    "newText"
                  ],
                  "additionalProperties": false
                },
                "minItems": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "edits"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "json_patch"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "patch": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "op": {
                      "type": "string",
                      "enum": [
                        "add",
                        "replace",
                        "remove"
                      ]
                    },
                    "path": {
                      "type": "string",
                      "minLength": 1
                    },
                    "value": true
                  },
                  "required": [
                    "op",
                    "path"
                  ],
                  "additionalProperties": false
                },
                "minItems": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "patch"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "unified_diff"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "diff": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256",
              "diff"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "delete"
              },
              "path": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              }
            },
            "required": [
              "op",
              "path",
              "expectedSha256"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "rename"
              },
              "from": {
                "type": "string",
                "minLength": 1
              },
              "to": {
                "type": "string",
                "minLength": 1
              },
              "expectedSha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              }
            },
            "required": [
              "op",
              "from",
              "to",
              "expectedSha256"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "mkdir"
              },
              "path": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "op",
              "path"
            ],
            "additionalProperties": false
          }
        ]
      },
      "minItems": 1
    }
  },
  "required": [
    "previewHash",
    "changes"
  ],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "blocked"
      ]
    },
    "applied": {
      "type": "boolean"
    },
    "verified": {
      "type": "boolean"
    },
    "verification": {
      "type": "object",
      "additionalProperties": true
    },
    "baseRevision": {
      "type": "string"
    },
    "base": {
      "type": "object",
      "additionalProperties": true
    },
    "summary": {
      "type": "object",
      "additionalProperties": true
    },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "conflicts": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "previewHash": {
      "type": "string",
      "pattern": "^sha256:[a-f0-9]{64}$"
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "risk": {
      "type": "object",
      "additionalProperties": true
    },
    "manualPlan": {
      "type": "object",
      "additionalProperties": true
    }
  },
  "required": [
    "applied",
    "verified",
    "verification",
    "base",
    "summary",
    "files",
    "conflicts",
    "hostRisk",
    "risk"
  ],
  "additionalProperties": false
}
```

Examples:

- apply text edit
tool: change.apply
```json tool=change.apply
{
  "previewHash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "changes": [
    {
      "op": "edit",
      "path": "README.md",
      "expectedSha256": "0000000000000000000000000000000000000000000000000000000000000000",
      "edits": [
        {
          "oldText": "old",
          "newText": "new"
        }
      ]
    }
  ]
}
```

## manual.prepare

Stores low-risk continuation metadata only; commands, diffs, stdout, stderr, logs, and content are rejected.

Modes: dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {
    "operation": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100,
          "pattern": "^[A-Za-z0-9_.-]+$"
        },
        "kind": {
          "type": "string",
          "enum": [
            "task",
            "change",
            "external"
          ]
        }
      },
      "required": [
        "id",
        "kind"
      ],
      "additionalProperties": false
    },
    "originalRequestSummary": {
      "type": "string",
      "minLength": 1,
      "maxLength": 1000
    },
    "interruptedAt": {
      "type": "string",
      "enum": [
        "task",
        "edit",
        "test",
        "commit",
        "other"
      ]
    },
    "verificationPlan": {
      "type": "array",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "properties": {
              "kind": {
                "const": "workspace-path-state"
              },
              "path": {
                "type": "string",
                "minLength": 1,
                "maxLength": 500
              },
              "expected": {
                "oneOf": [
                  {
                    "type": "object",
                    "properties": {
                      "exists": {
                        "const": true
                      },
                      "type": {
                        "type": "string",
                        "enum": [
                          "file",
                          "directory"
                        ]
                      },
                      "sha256": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "exists"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "exists": {
                        "const": false
                      }
                    },
                    "required": [
                      "exists"
                    ],
                    "additionalProperties": false
                  }
                ]
              }
            },
            "required": [
              "kind",
              "path",
              "expected"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "kind": {
                "const": "git-worktree"
              },
              "paths": {
                "type": "array",
                "items": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 500
                },
                "maxItems": 100
              },
              "expected": {
                "type": "string",
                "enum": [
                  "changed",
                  "clean",
                  "any"
                ]
              }
            },
            "required": [
              "kind",
              "expected"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "kind": {
                "const": "none"
              },
              "description": {
                "type": "string",
                "minLength": 1,
                "maxLength": 500
              }
            },
            "required": [
              "kind",
              "description"
            ],
            "additionalProperties": false
          }
        ]
      },
      "maxItems": 50
    },
    "nextAfterResume": {
      "type": "object",
      "properties": {
        "tool": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "required": [
        "tool",
        "reason"
      ],
      "additionalProperties": false
    }
  },
  "required": [
    "operation",
    "originalRequestSummary",
    "interruptedAt",
    "nextAfterResume"
  ],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "structuredContent": {
      "type": "object",
      "properties": {
        "status": {
          "type": "string",
          "enum": [
            "prepared"
          ]
        },
        "operationId": {
          "type": "string"
        },
        "operation": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "minLength": 1,
              "maxLength": 100,
              "pattern": "^[A-Za-z0-9_.-]+$"
            },
            "kind": {
              "type": "string",
              "enum": [
                "task",
                "change",
                "external"
              ]
            }
          },
          "required": [
            "id",
            "kind"
          ],
          "additionalProperties": false
        },
        "preparedId": {
          "type": "string"
        },
        "expiresAt": {
          "type": "string"
        },
        "gateTool": {
          "type": "string",
          "enum": [
            "manual.gate"
          ]
        },
        "resumeTool": {
          "type": "string",
          "enum": [
            "manual.resume"
          ]
        },
        "verificationPlan": {
          "type": "object",
          "properties": {
            "checkCount": {
              "type": "integer",
              "minimum": 0
            }
          },
          "required": [
            "checkCount"
          ],
          "additionalProperties": false
        },
        "continuation": {
          "type": "object",
          "properties": {
            "mode": {
              "type": "string",
              "enum": [
                "show_manual_instructions_then_open_gate"
              ]
            },
            "mustShowManualInstructions": {
              "type": "boolean"
            },
            "mustNotIncludeManualPayloadInGate": {
              "type": "boolean"
            }
          },
          "required": [
            "mode",
            "mustShowManualInstructions",
            "mustNotIncludeManualPayloadInGate"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "status",
        "operationId",
        "operation",
        "preparedId",
        "expiresAt",
        "gateTool",
        "resumeTool",
        "verificationPlan",
        "continuation"
      ],
      "additionalProperties": false
    },
    "content": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "text"
            ]
          },
          "text": {
            "type": "string"
          }
        },
        "required": [
          "type",
          "text"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "hostRisk",
    "structuredContent",
    "content"
  ],
  "additionalProperties": false
}
```

Examples:

- prepare manual task
tool: manual.prepare
```json tool=manual.prepare
{
  "operation": {
    "id": "manual-task",
    "kind": "task"
  },
  "originalRequestSummary": "Run a required external command.",
  "interruptedAt": "task",
  "verificationPlan": [
    {
      "kind": "none",
      "description": "User reports command completion."
    }
  ],
  "nextAfterResume": {
    "tool": "workspace.context",
    "reason": "Verify workspace state after resume."
  }
}
```

## manual.gate

Opens the local manual barrier with v1 proof fields and low-risk hostObservation only.

Modes: dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {
    "preparedId": {
      "type": "string"
    },
    "reason": {
      "type": "string",
      "enum": [
        "openai_safety_block",
        "manual_review_requested",
        "external_manual_step"
      ]
    },
    "manualFormatVersion": {
      "type": "string",
      "enum": [
        "WEBVIBE_MANUAL_REQUIRED v1"
      ]
    },
    "manualMessageHash": {
      "type": "string",
      "pattern": "^sha256:[0-9a-f]{64}$"
    },
    "operation": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100,
          "pattern": "^[A-Za-z0-9_.-]+$"
        },
        "kind": {
          "type": "string",
          "enum": [
            "task",
            "change",
            "external"
          ]
        }
      },
      "required": [
        "id",
        "kind"
      ],
      "additionalProperties": false
    },
    "hostObservation": {
      "type": "object",
      "properties": {
        "toolName": {
          "type": "string"
        },
        "classification": {
          "type": "string"
        },
        "outputText": {
          "type": "string",
          "maxLength": 4000
        }
      },
      "required": [],
      "additionalProperties": false
    }
  },
  "required": [
    "reason",
    "manualFormatVersion",
    "manualMessageHash",
    "operation"
  ],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "structuredContent": {
      "type": "object",
      "properties": {
        "status": {
          "type": "string",
          "enum": [
            "awaiting_manual_completion"
          ]
        },
        "operationId": {
          "type": "string"
        },
        "operation": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "minLength": 1,
              "maxLength": 100,
              "pattern": "^[A-Za-z0-9_.-]+$"
            },
            "kind": {
              "type": "string",
              "enum": [
                "task",
                "change",
                "external"
              ]
            }
          },
          "required": [
            "id",
            "kind"
          ],
          "additionalProperties": false
        },
        "manualFormatVersion": {
          "type": "string",
          "enum": [
            "WEBVIBE_MANUAL_REQUIRED v1"
          ]
        },
        "manualMessageHash": {
          "type": "string",
          "pattern": "^sha256:[0-9a-f]{64}$"
        },
        "pendingId": {
          "type": "string"
        },
        "preparedId": {
          "type": "string"
        },
        "reason": {
          "type": "string",
          "enum": [
            "openai_safety_block",
            "manual_review_requested",
            "external_manual_step"
          ]
        },
        "expiresAt": {
          "type": "string"
        },
        "resumeTool": {
          "type": "string",
          "enum": [
            "manual.resume"
          ]
        },
        "continuation": {
          "type": "object",
          "properties": {
            "mode": {
              "type": "string",
              "enum": [
                "await_resume_command"
              ]
            },
            "modelShouldStop": {
              "type": "boolean"
            },
            "mustEndTurn": {
              "type": "boolean"
            },
            "resumeMode": {
              "type": "string",
              "enum": [
                "resume_interrupted_workflow"
              ]
            }
          },
          "required": [
            "mode",
            "modelShouldStop",
            "mustEndTurn",
            "resumeMode"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "status",
        "operationId",
        "operation",
        "manualFormatVersion",
        "manualMessageHash",
        "pendingId",
        "reason",
        "expiresAt",
        "resumeTool",
        "continuation"
      ],
      "additionalProperties": false
    },
    "content": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "text"
            ]
          },
          "text": {
            "type": "string"
          }
        },
        "required": [
          "type",
          "text"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "hostRisk",
    "structuredContent",
    "content"
  ],
  "additionalProperties": false
}
```

Examples:

- open external manual gate
tool: manual.gate
```json tool=manual.gate
{
  "reason": "external_manual_step",
  "manualFormatVersion": "WEBVIBE_MANUAL_REQUIRED v1",
  "manualMessageHash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "operation": {
    "id": "manual-task",
    "kind": "task"
  },
  "hostObservation": {
    "toolName": "capability.limit",
    "outputText": "manual step required because required execution capability is unavailable"
  }
}
```

## manual.status

Reports whether a manual barrier is pending and which resume route to use.

Modes: dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {},
  "required": [],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "pending",
        "none"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "pending": {
      "type": "object",
      "additionalProperties": true
    },
    "expired": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "next": {
      "type": "object",
      "properties": {
        "recommendedTools": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "mode": {
          "type": "string",
          "enum": [
            "await_resume_command",
            "normal_workflow"
          ]
        },
        "followUpPrompt": {
          "type": "string"
        }
      },
      "required": [
        "recommendedTools",
        "mode",
        "followUpPrompt"
      ],
      "additionalProperties": false
    }
  },
  "required": [
    "status",
    "hostRisk",
    "expired",
    "next"
  ],
  "additionalProperties": false
}
```

Examples:

- manual status
tool: manual.status
```json tool=manual.status
{}
```

## manual.resume

Validates the /resume control message, records optional log evidence, and verifies configured checks.

Modes: dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {
    "resumeMessage": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2000
    }
  },
  "required": [
    "resumeMessage"
  ],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "confirmed",
        "cancelled",
        "verification_failed",
        "expired",
        "not_found",
        "blocked"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "code": {
      "type": "string",
      "enum": [
        "RESUME_COMMAND_REQUIRED"
      ]
    },
    "operationId": {
      "type": "string"
    },
    "pendingId": {
      "type": "string"
    },
    "preparedId": {
      "type": "string"
    },
    "reason": {
      "type": "string"
    },
    "outcome": {
      "type": "string",
      "enum": [
        "completed",
        "cancelled"
      ]
    },
    "verification": {
      "type": "object",
      "additionalProperties": true
    },
    "evidence": {
      "type": "object",
      "additionalProperties": true
    },
    "next": {
      "type": "object",
      "properties": {
        "recommendedTools": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "followUpPrompt": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "await_resume_command",
            "resume_interrupted_workflow"
          ]
        },
        "verifyBeforeContinuing": {
          "type": "boolean"
        }
      },
      "required": [
        "recommendedTools",
        "followUpPrompt",
        "mode",
        "verifyBeforeContinuing"
      ],
      "additionalProperties": false
    }
  },
  "required": [
    "status",
    "hostRisk",
    "verification",
    "next"
  ],
  "additionalProperties": false
}
```

Examples:

- resume
tool: manual.resume
```json tool=manual.resume
{
  "resumeMessage": "/resume manual-task"
}
```

## task.list

Returns configured task availability, resolver checks, unavailable reasons, and candidates.

Modes: dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {},
  "required": [],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ok"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "tasks": {
      "type": "object",
      "properties": {
        "available": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "unavailable": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "candidates": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": true
          }
        }
      },
      "required": [
        "available",
        "unavailable",
        "candidates"
      ],
      "additionalProperties": false
    },
    "truncated": {
      "type": "boolean"
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "next": {
      "type": "object",
      "properties": {
        "tool": {
          "type": "string"
        },
        "reason": {
          "type": "string"
        },
        "alternatives": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "args": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "tool",
        "reason"
      ],
      "additionalProperties": true
    }
  },
  "required": [
    "status",
    "hostRisk",
    "tasks",
    "truncated",
    "nextCursor",
    "next"
  ],
  "additionalProperties": false
}
```

Examples:

- list tasks
tool: task.list
```json tool=task.list
{}
```

## task.explain

Explains whether a task ID is runnable, unavailable, candidate-only, or manual-first.

Modes: dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {
    "taskId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    }
  },
  "required": [
    "taskId"
  ],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "available",
        "unavailable",
        "candidate",
        "manualFirst"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "taskId": {
      "type": "string"
    },
    "task": {
      "type": "object",
      "additionalProperties": true
    },
    "decision": {
      "type": "string"
    },
    "next": {
      "type": "object",
      "additionalProperties": true
    }
  },
  "required": [
    "status",
    "hostRisk",
    "taskId",
    "decision",
    "next"
  ],
  "additionalProperties": false
}
```

Examples:

- explain test
tool: task.explain
```json tool=task.explain
{
  "taskId": "node.test"
}
```

## task.run

Runs only configured or policy-allowed candidate task IDs and returns bounded log summaries.

Modes: dev
Risk: medium

Input schema:

```json
{
  "type": "object",
  "properties": {
    "taskId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "timeoutSeconds": {
      "type": "integer",
      "minimum": 1,
      "maximum": 36000
    },
    "extra": {
      "type": "object",
      "properties": {
        "packages": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 20
        },
        "modules": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 20
        },
        "dev": {
          "type": "boolean"
        }
      },
      "required": [],
      "additionalProperties": false
    },
    "cwd": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500
    },
    "mode": {
      "type": "string",
      "enum": [
        "foreground",
        "background"
      ]
    }
  },
  "required": [
    "taskId"
  ],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "running",
        "ok",
        "failed",
        "timeout",
        "unavailable"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "medium"
      ]
    },
    "runId": {
      "type": "string"
    },
    "taskId": {
      "type": "string"
    },
    "exitCode": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ]
    },
    "stdout": {
      "type": "object",
      "properties": {
        "head": {
          "type": "string"
        },
        "tail": {
          "type": "string"
        },
        "truncated": {
          "type": "boolean"
        },
        "sha256": {
          "type": "string"
        },
        "bytes": {
          "type": "integer",
          "minimum": 0
        },
        "logPath": {
          "type": "string"
        }
      },
      "required": [
        "head",
        "tail",
        "truncated",
        "sha256",
        "bytes",
        "logPath"
      ],
      "additionalProperties": false
    },
    "stderr": {
      "type": "object",
      "properties": {
        "head": {
          "type": "string"
        },
        "tail": {
          "type": "string"
        },
        "truncated": {
          "type": "boolean"
        },
        "sha256": {
          "type": "string"
        },
        "bytes": {
          "type": "integer",
          "minimum": 0
        },
        "logPath": {
          "type": "string"
        }
      },
      "required": [
        "head",
        "tail",
        "truncated",
        "sha256",
        "bytes",
        "logPath"
      ],
      "additionalProperties": false
    },
    "diagnostics": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "line": {
            "type": "integer",
            "minimum": 1
          },
          "column": {
            "type": "integer",
            "minimum": 1
          },
          "message": {
            "type": "string"
          },
          "severity": {
            "type": "string",
            "enum": [
              "error",
              "warning",
              "info"
            ]
          }
        },
        "required": [
          "path",
          "line",
          "message"
        ],
        "additionalProperties": false
      }
    },
    "durationMs": {
      "type": "integer",
      "minimum": 0
    },
    "timeoutSeconds": {
      "type": "integer",
      "minimum": 0
    },
    "effectiveCommand": {
      "type": "object",
      "properties": {
        "executable": {
          "type": "string"
        },
        "args": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "cwd": {
          "type": "string"
        }
      },
      "required": [
        "executable",
        "args",
        "cwd"
      ],
      "additionalProperties": false
    },
    "checks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "path": {
            "type": "string"
          },
          "ok": {
            "type": "boolean"
          },
          "reason": {
            "type": "string"
          }
        },
        "required": [
          "kind",
          "ok"
        ],
        "additionalProperties": false
      }
    },
    "cwd": {
      "type": "string"
    },
    "startedAt": {
      "type": "string"
    },
    "completedAt": {
      "type": "string"
    },
    "unavailableReason": {
      "type": "string"
    },
    "manualRequired": {
      "type": "object",
      "properties": {
        "nextTool": {
          "type": "string",
          "enum": [
            "manual.gate"
          ]
        },
        "reason": {
          "type": "string",
          "enum": [
            "external_manual_step"
          ]
        },
        "userInstructions": {
          "type": "string"
        },
        "hostObservation": {
          "type": "object",
          "properties": {
            "toolName": {
              "type": "string"
            },
            "outputText": {
              "type": "string"
            }
          },
          "required": [
            "toolName",
            "outputText"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "nextTool",
        "reason",
        "userInstructions",
        "hostObservation"
      ],
      "additionalProperties": false
    },
    "next": {
      "type": "object",
      "additionalProperties": true
    }
  },
  "required": [
    "status",
    "hostRisk",
    "runId",
    "taskId",
    "exitCode",
    "stdout",
    "stderr",
    "diagnostics",
    "durationMs",
    "timeoutSeconds",
    "effectiveCommand",
    "checks",
    "next"
  ],
  "additionalProperties": false
}
```

Examples:

- run test
tool: task.run
```json tool=task.run
{
  "taskId": "node.test"
}
```

## task.result

Reads a foreground or background task record by runId.

Modes: dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "runId"
  ],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "running",
        "ok",
        "failed",
        "timeout",
        "unavailable"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "medium"
      ]
    },
    "runId": {
      "type": "string"
    },
    "taskId": {
      "type": "string"
    },
    "exitCode": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ]
    },
    "stdout": {
      "type": "object",
      "properties": {
        "head": {
          "type": "string"
        },
        "tail": {
          "type": "string"
        },
        "truncated": {
          "type": "boolean"
        },
        "sha256": {
          "type": "string"
        },
        "bytes": {
          "type": "integer",
          "minimum": 0
        },
        "logPath": {
          "type": "string"
        }
      },
      "required": [
        "head",
        "tail",
        "truncated",
        "sha256",
        "bytes",
        "logPath"
      ],
      "additionalProperties": false
    },
    "stderr": {
      "type": "object",
      "properties": {
        "head": {
          "type": "string"
        },
        "tail": {
          "type": "string"
        },
        "truncated": {
          "type": "boolean"
        },
        "sha256": {
          "type": "string"
        },
        "bytes": {
          "type": "integer",
          "minimum": 0
        },
        "logPath": {
          "type": "string"
        }
      },
      "required": [
        "head",
        "tail",
        "truncated",
        "sha256",
        "bytes",
        "logPath"
      ],
      "additionalProperties": false
    },
    "diagnostics": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "line": {
            "type": "integer",
            "minimum": 1
          },
          "column": {
            "type": "integer",
            "minimum": 1
          },
          "message": {
            "type": "string"
          },
          "severity": {
            "type": "string",
            "enum": [
              "error",
              "warning",
              "info"
            ]
          }
        },
        "required": [
          "path",
          "line",
          "message"
        ],
        "additionalProperties": false
      }
    },
    "durationMs": {
      "type": "integer",
      "minimum": 0
    },
    "timeoutSeconds": {
      "type": "integer",
      "minimum": 0
    },
    "effectiveCommand": {
      "type": "object",
      "properties": {
        "executable": {
          "type": "string"
        },
        "args": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "cwd": {
          "type": "string"
        }
      },
      "required": [
        "executable",
        "args",
        "cwd"
      ],
      "additionalProperties": false
    },
    "checks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "path": {
            "type": "string"
          },
          "ok": {
            "type": "boolean"
          },
          "reason": {
            "type": "string"
          }
        },
        "required": [
          "kind",
          "ok"
        ],
        "additionalProperties": false
      }
    },
    "cwd": {
      "type": "string"
    },
    "startedAt": {
      "type": "string"
    },
    "completedAt": {
      "type": "string"
    },
    "unavailableReason": {
      "type": "string"
    },
    "manualRequired": {
      "type": "object",
      "properties": {
        "nextTool": {
          "type": "string",
          "enum": [
            "manual.gate"
          ]
        },
        "reason": {
          "type": "string",
          "enum": [
            "external_manual_step"
          ]
        },
        "userInstructions": {
          "type": "string"
        },
        "hostObservation": {
          "type": "object",
          "properties": {
            "toolName": {
              "type": "string"
            },
            "outputText": {
              "type": "string"
            }
          },
          "required": [
            "toolName",
            "outputText"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "nextTool",
        "reason",
        "userInstructions",
        "hostObservation"
      ],
      "additionalProperties": false
    },
    "next": {
      "type": "object",
      "additionalProperties": true
    }
  },
  "required": [
    "status",
    "hostRisk",
    "runId",
    "taskId",
    "exitCode",
    "stdout",
    "stderr",
    "diagnostics",
    "durationMs",
    "timeoutSeconds",
    "effectiveCommand",
    "checks",
    "next"
  ],
  "additionalProperties": false
}
```

Examples:

- read task result
tool: task.result
```json tool=task.result
{
  "runId": "tr_example"
}
```

## git.status

Returns branch, head, clean flag, and concise porcelain stdout.

Modes: read-only, dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {},
  "required": [],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ok",
        "failed",
        "timeout",
        "unavailable"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "command": {
      "type": "string"
    },
    "exitCode": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ]
    },
    "stdout": {
      "type": "string"
    },
    "stderr": {
      "type": "string"
    },
    "durationMs": {
      "type": "integer",
      "minimum": 0
    },
    "unavailableReason": {
      "type": "string"
    },
    "branch": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "head": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "upstream": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "aheadBehind": {
      "type": "object",
      "properties": {
        "ahead": {
          "type": "integer",
          "minimum": 0
        },
        "behind": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "ahead",
        "behind"
      ],
      "additionalProperties": false
    },
    "clean": {
      "type": "boolean"
    }
  },
  "required": [
    "status",
    "hostRisk",
    "command",
    "exitCode",
    "stdout",
    "stderr",
    "durationMs"
  ],
  "additionalProperties": false
}
```

Examples:

- status
tool: git.status
```json tool=git.status
{}
```

## git.changed

Returns staged, unstaged, untracked, and combined changed path lists.

Modes: read-only, dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {},
  "required": [],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ok",
        "failed",
        "timeout",
        "unavailable"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "command": {
      "type": "string"
    },
    "exitCode": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ]
    },
    "stdout": {
      "type": "string"
    },
    "stderr": {
      "type": "string"
    },
    "durationMs": {
      "type": "integer",
      "minimum": 0
    },
    "unavailableReason": {
      "type": "string"
    },
    "staged": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "index": {
            "type": "string"
          },
          "worktree": {
            "type": "string"
          },
          "nameStatus": {
            "type": "string"
          },
          "originalPath": {
            "type": "string"
          }
        },
        "required": [
          "path",
          "index",
          "worktree",
          "nameStatus"
        ],
        "additionalProperties": false
      }
    },
    "unstaged": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "index": {
            "type": "string"
          },
          "worktree": {
            "type": "string"
          },
          "nameStatus": {
            "type": "string"
          },
          "originalPath": {
            "type": "string"
          }
        },
        "required": [
          "path",
          "index",
          "worktree",
          "nameStatus"
        ],
        "additionalProperties": false
      }
    },
    "untracked": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "index": {
            "type": "string"
          },
          "worktree": {
            "type": "string"
          },
          "nameStatus": {
            "type": "string"
          },
          "originalPath": {
            "type": "string"
          }
        },
        "required": [
          "path",
          "index",
          "worktree",
          "nameStatus"
        ],
        "additionalProperties": false
      }
    },
    "changes": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "index": {
            "type": "string"
          },
          "worktree": {
            "type": "string"
          },
          "nameStatus": {
            "type": "string"
          },
          "originalPath": {
            "type": "string"
          }
        },
        "required": [
          "path",
          "index",
          "worktree",
          "nameStatus"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "status",
    "hostRisk",
    "command",
    "exitCode",
    "stdout",
    "stderr",
    "durationMs"
  ],
  "additionalProperties": false
}
```

Examples:

- changed files
tool: git.changed
```json tool=git.changed
{}
```

## git.diff

Returns bounded staged or unstaged diff stdout with cursor-based byte continuation.

Modes: read-only, dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {
    "scope": {
      "type": "string",
      "enum": [
        "unstaged",
        "staged"
      ]
    },
    "path": {
      "type": "string"
    },
    "maxBytes": {
      "type": "integer",
      "minimum": 1,
      "maximum": 60000
    },
    "cursor": {
      "type": "string"
    }
  },
  "required": [],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ok",
        "failed",
        "timeout",
        "unavailable"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "command": {
      "type": "string"
    },
    "exitCode": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ]
    },
    "stdout": {
      "type": "string"
    },
    "stderr": {
      "type": "string"
    },
    "durationMs": {
      "type": "integer",
      "minimum": 0
    },
    "unavailableReason": {
      "type": "string"
    },
    "offsetBytes": {
      "type": "integer",
      "minimum": 0
    },
    "returnedBytes": {
      "type": "integer",
      "minimum": 0
    },
    "totalBytes": {
      "type": "integer",
      "minimum": 0
    },
    "stdoutSha256": {
      "type": "string",
      "pattern": "^sha256:[a-f0-9]{64}$"
    },
    "truncated": {
      "type": "boolean"
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "status",
    "hostRisk",
    "command",
    "exitCode",
    "stdout",
    "stderr",
    "durationMs"
  ],
  "additionalProperties": false
}
```

Examples:

- unstaged diff
tool: git.diff
```json tool=git.diff
{
  "scope": "unstaged",
  "maxBytes": 60000
}
```

## git.show

Returns a bounded revision stat and patch with cursor-based byte continuation.

Modes: read-only, dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {
    "revision": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "path": {
      "type": "string"
    },
    "maxBytes": {
      "type": "integer",
      "minimum": 1,
      "maximum": 60000
    },
    "cursor": {
      "type": "string"
    }
  },
  "required": [],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ok",
        "failed",
        "timeout",
        "unavailable"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "command": {
      "type": "string"
    },
    "exitCode": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ]
    },
    "stdout": {
      "type": "string"
    },
    "stderr": {
      "type": "string"
    },
    "durationMs": {
      "type": "integer",
      "minimum": 0
    },
    "unavailableReason": {
      "type": "string"
    },
    "offsetBytes": {
      "type": "integer",
      "minimum": 0
    },
    "returnedBytes": {
      "type": "integer",
      "minimum": 0
    },
    "totalBytes": {
      "type": "integer",
      "minimum": 0
    },
    "stdoutSha256": {
      "type": "string",
      "pattern": "^sha256:[a-f0-9]{64}$"
    },
    "truncated": {
      "type": "boolean"
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "status",
    "hostRisk",
    "command",
    "exitCode",
    "stdout",
    "stderr",
    "durationMs"
  ],
  "additionalProperties": false
}
```

Examples:

- show head
tool: git.show
```json tool=git.show
{
  "revision": "HEAD",
  "maxBytes": 60000
}
```

## git.blame

Returns porcelain blame metadata for one workspace file and line range.

Modes: read-only, dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string"
    },
    "startLine": {
      "type": "integer",
      "minimum": 1
    },
    "endLine": {
      "type": "integer",
      "minimum": 1
    }
  },
  "required": [
    "path"
  ],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ok",
        "failed",
        "timeout",
        "unavailable"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "command": {
      "type": "string"
    },
    "exitCode": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ]
    },
    "stdout": {
      "type": "string"
    },
    "stderr": {
      "type": "string"
    },
    "durationMs": {
      "type": "integer",
      "minimum": 0
    },
    "unavailableReason": {
      "type": "string"
    },
    "path": {
      "type": "string"
    },
    "startLine": {
      "type": "integer",
      "minimum": 1
    },
    "endLine": {
      "type": "integer",
      "minimum": 1
    },
    "lines": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "commit": {
            "type": "string"
          },
          "line": {
            "type": "integer",
            "minimum": 1
          },
          "author": {
            "type": "string"
          },
          "authorTime": {
            "type": "integer",
            "minimum": 0
          },
          "content": {
            "type": "string"
          }
        },
        "required": [
          "commit",
          "line",
          "content"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "status",
    "hostRisk",
    "command",
    "exitCode",
    "stdout",
    "stderr",
    "durationMs"
  ],
  "additionalProperties": false
}
```

Examples:

- blame first line
tool: git.blame
```json tool=git.blame
{
  "path": "README.md",
  "startLine": 1,
  "endLine": 1
}
```

## git.commit_preview

Uses a temporary index to preview the exact explicit paths that git.commit can commit.

Modes: read-only, dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {
    "paths": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "minItems": 1,
      "maxItems": 1000
    }
  },
  "required": [
    "paths"
  ],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ok",
        "failed",
        "timeout",
        "unavailable"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "command": {
      "type": "string"
    },
    "exitCode": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ]
    },
    "stdout": {
      "type": "string"
    },
    "stderr": {
      "type": "string"
    },
    "durationMs": {
      "type": "integer",
      "minimum": 0
    },
    "unavailableReason": {
      "type": "string"
    },
    "paths": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "diff": {
      "type": "string"
    },
    "nameStatus": {
      "type": "string"
    },
    "clean": {
      "type": "boolean"
    },
    "previewHash": {
      "type": "string",
      "pattern": "^sha256:[a-f0-9]{64}$"
    }
  },
  "required": [
    "status",
    "hostRisk",
    "command",
    "exitCode",
    "stdout",
    "stderr",
    "durationMs"
  ],
  "additionalProperties": false
}
```

Examples:

- preview commit
tool: git.commit_preview
```json tool=git.commit_preview
{
  "paths": [
    "README.md"
  ]
}
```

## git.commit

Creates a commit only after git.commit_preview returns a matching previewHash.

Modes: dev
Risk: medium

Input schema:

```json
{
  "type": "object",
  "properties": {
    "paths": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "minItems": 1,
      "maxItems": 1000
    },
    "message": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500
    },
    "previewHash": {
      "type": "string",
      "pattern": "^sha256:[a-f0-9]{64}$"
    }
  },
  "required": [
    "paths",
    "message",
    "previewHash"
  ],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ok",
        "failed",
        "timeout",
        "unavailable"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "command": {
      "type": "string"
    },
    "exitCode": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ]
    },
    "stdout": {
      "type": "string"
    },
    "stderr": {
      "type": "string"
    },
    "durationMs": {
      "type": "integer",
      "minimum": 0
    },
    "unavailableReason": {
      "type": "string"
    }
  },
  "required": [
    "status",
    "hostRisk",
    "command",
    "exitCode",
    "stdout",
    "stderr",
    "durationMs"
  ],
  "additionalProperties": false
}
```

Examples:

- commit explicit paths
tool: git.commit
```json tool=git.commit
{
  "paths": [
    "README.md"
  ],
  "message": "Update README",
  "previewHash": "sha256:0000000000000000000000000000000000000000000000000000000000000000"
}
```

## diagnostics.health

Reports relay, policy, tool surface, instruction, upstream, and recent tool error diagnostics.

Modes: read-only, dev
Risk: low

Input schema:

```json
{
  "type": "object",
  "properties": {},
  "required": [],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ok"
      ]
    },
    "hostRisk": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "truncated": {
      "type": "boolean"
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "name": {
      "type": "string"
    },
    "server": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string"
        },
        "version": {
          "type": "string"
        }
      },
      "required": [
        "name",
        "version"
      ],
      "additionalProperties": false
    },
    "mode": {
      "type": "string",
      "enum": [
        "read-only",
        "dev"
      ]
    },
    "activeProfile": {
      "type": "string"
    },
    "policy": {
      "type": "object",
      "additionalProperties": true
    },
    "toolSurface": {
      "type": "object",
      "properties": {
        "version": {
          "type": "string"
        },
        "hash": {
          "type": "string"
        },
        "toolCount": {
          "type": "integer",
          "minimum": 0
        },
        "tools": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "version",
        "hash",
        "toolCount",
        "tools"
      ],
      "additionalProperties": false
    },
    "instructions": {
      "type": "object",
      "properties": {
        "version": {
          "type": "string"
        },
        "hash": {
          "type": "string"
        }
      },
      "required": [
        "version",
        "hash"
      ],
      "additionalProperties": false
    },
    "validFor": {
      "type": "object",
      "additionalProperties": true
    },
    "upstreams": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "recentToolErrors": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "next": {
      "type": "object",
      "properties": {
        "tool": {
          "type": "string"
        },
        "reason": {
          "type": "string"
        },
        "alternatives": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "args": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "tool",
        "reason"
      ],
      "additionalProperties": true
    }
  },
  "required": [
    "status",
    "hostRisk",
    "truncated",
    "nextCursor",
    "name",
    "server",
    "mode",
    "activeProfile",
    "policy",
    "toolSurface",
    "instructions",
    "validFor",
    "upstreams",
    "recentToolErrors",
    "next"
  ],
  "additionalProperties": false
}
```

Examples:

- health
tool: diagnostics.health
```json tool=diagnostics.health
{}
```

