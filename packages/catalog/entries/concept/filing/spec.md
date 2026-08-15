# Filing

## Purpose

Keep authoritative named byte trees and replace a host-backed tree only after its
complete readable contents are known, so readers never observe a partial import.

## Principle

Ada loads a host directory as the named tree `notes`. Reading its page returns the
exact bytes, the same text when those bytes are UTF-8, and a stable digest. She
changes one file, removes another, and loads `notes` again; the surviving file keeps
its identity, the omitted file disappears, and readers see the new tree only after
the whole load succeeds. A later load encounters a symbolic link and reports a
problem without changing the preceding tree. The page can resolve `./picture.png`,
but a reference cannot climb outside the logical tree.

## Types

```types
external HostPath
  A native filesystem path supplied for one load. Filing does not retain it.
```

## State

```state
a set of Roots with
  unique name Name

a set of Files with
  root Root
  canonical path Path unique within root
  copied content Bytes
  digest Digest
```

Each Name identifies one stable Root. Each `(Root, Path)` identifies one stable
File, including after removal and recreation. A host load reads every candidate
byte before replacing the Root. A reported problem leaves the preceding tree
unchanged. Filing copies bytes on input and output; `changed` compares exact bytes.
A host load is not a filesystem-wide snapshot when another process mutates the tree
while it is read.

## Actions

```actions
replaceTreeFromFile (name: Name, source: HostPath, path: Path) : return (status: LoadStatus, root?: Root, file?: File, digest?: Digest, count?: Number, changed?: Flag, code?: ProblemCode, detail?: Text)
  where name or source is not well-formed nonempty text
  then
    refuse INVALID_SOURCE "A host load needs well-formed, non-empty name and source text."
  where path climbs outside its logical root
  then
    refuse PATH_LEAVES_ROOT "A file path must stay inside its root."
  where path is not canonical
  then
    refuse INVALID_PATH "A file path must use the canonical portable form."
  where the host file is missing, unreadable, symbolic, or not ordinary
  then
    leave the named tree unchanged and report a stable problem code and detail
    return status, root, file, digest, count, changed, code, detail
  where the host file and logical path are accepted
  then
    replace the named tree with that file
    return status, root, file, digest, count, changed, code, detail

replaceTreeFromDirectory (name: Name, directory: HostPath) : return (status: LoadStatus, root?: Root, count?: Number, changed?: Flag, code?: ProblemCode, detail?: Text)
  where name or directory is not well-formed nonempty text
  then
    refuse INVALID_SOURCE "A host load needs well-formed, non-empty name and source text."
  where the directory or any descendant is missing, unreadable, symbolic, unnameable, or not ordinary
  then
    leave the named tree unchanged and report a stable problem code and detail
    return status, root, count, changed, code, detail
  where the complete directory tree was read successfully
  then
    replace the named tree with every read file
    return status, root, count, changed, code, detail

ensureRoot (name: Name) : return (root: Root)
  where a Root already has name
  then
    return root
  where no Root has name
  then
    add a Root with name
    return root

putFile (root: Root, path: Path, content: Bytes) : return (file: File, digest: Digest, changed: Flag)
  where root is unknown
  then
    refuse ROOT_NOT_FOUND "There is no such root."
  where path climbs outside root
  then
    refuse PATH_LEAVES_ROOT "A file path must stay inside its root."
  where path is not canonical
  then
    refuse INVALID_PATH "A file path must use the canonical portable form."
  where a File already has root and path
  then
    replace its content with a copy and retain its identity
    return file, digest, changed
  where no File has root and path
  then
    add a File with copied content
    return file, digest, changed

putBase64File (root: Root, path: Path, encoded: Text) : return (file: File, digest: Digest, changed: Flag)
  where encoded is not canonical Base64
  then
    refuse INVALID_ENCODING "Staged file content must use canonical Base64."
  where encoded is canonical and root is unknown
  then
    refuse ROOT_NOT_FOUND "There is no such root."
  where encoded is canonical and path climbs outside root
  then
    refuse PATH_LEAVES_ROOT "A file path must stay inside its root."
  where encoded is canonical and path is not canonical
  then
    refuse INVALID_PATH "A file path must use the canonical portable form."
  where encoded, root, and path are accepted
  then
    decode and place the exact bytes as putFile would
    return file, digest, changed

discard (file: File) : return (root: Root, path: Path, name: Segment)
  where file is unknown
  then
    refuse FILE_NOT_FOUND "There is no such file."
  where file is known
  then
    remove it and return its logical address
    return root, path, name
```

## Queries

```queries
_root (root: Root) : optional (name: Name)
  Returns no row for an unknown Root.

_named (name: Name) : optional (root: Root)
  Returns no row when no Root has that exact Name.

_file (file: File) : optional (root: Root, path: Path, name: Segment, content: Bytes, digest: Digest)
  Returns no row for an unknown or removed File and copies returned bytes.

_text (file: File) : optional (text: Text)
  Strictly decodes all current bytes as UTF-8. Unknown Files and malformed UTF-8
  return no row; an initial byte-order mark is preserved.

_at (root: Root, path: Path) : optional (file: File, digest: Digest)
  Returns no row for an unknown Root, noncanonical Path, or absent File.

_files () : many (file: File, root: Root, path: Path)
  Groups Files by Root opening order and then ascending UTF-8 Path bytes.

_under (root: Root, prefix: Directory) : many (file: File, path: Path, digest: Digest)
  Treats prefix as a directory boundary and orders descendants by UTF-8 Path bytes.

_resolve (file: File, address: Address) : optional (target: File, path: Path)
  Resolves a local URI reference relative to the source File without crossing Roots
  and returns a row only when the target exists.

_resolution (file: File, address: Address) : one (status: ResolutionStatus)
  Reports found, missing, outside, nonlocal, invalid, or unknown-file using the same
  resolution rules as _resolve.
```
