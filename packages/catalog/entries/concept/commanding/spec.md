# Commanding

## Purpose

Own one command-line invocation's captured words, operator streams, and terminal
exit status, so an application can interact with the invocation without consulting
ambient process state or hiding application grammar in the host boundary.

## Principle

Ada invokes a tool with the words `publish notes`. Capturing the invocation returns
those exact words. The application interprets `publish` and `notes` outside
Commanding, writes a completion line to ordinary output and a warning to error
output, and selects exit status 2. Repeating the same capture or status is
idempotent; different words or a different status are refused. An embedding host
can supply an explicit word list instead of using ambient process arguments.

## Types

```types

```

## State

```state
an Invocation with
  optional words Arguments
  optional exitCode ExitCode
```

Arguments is an ordinary dense list of well-formed text. A Stream is `output` or
`error`. An ExitCode is a safe integer from 0 through 255.

## Actions

```actions
captureArguments (arguments: Arguments | null) : return (words: Arguments)
  where supplied or host arguments are not an ordinary dense list of well-formed text
  then
    refuse INVALID_ARGUMENTS "Arguments must be an ordinary dense list of text values."
  where different words were already captured
  then
    refuse INVOCATION_CAPTURED "This command invocation already has different words."
  where arguments are valid or the same invocation was already captured
  then
    retain the first words and return a copy
    return words

writeLine (stream: Stream, text: Text) : return (stream: Stream, text: Text)
  where stream is not output or error
  then
    refuse INVALID_STREAM "A command stream must be output or error."
  where text is not well-formed text
  then
    refuse INVALID_TEXT "A command line must be well-formed text."
  where stream and text are valid
  then
    write one line to the selected operator stream
    return stream, text

setExitStatus (code: ExitCode) : return (code: ExitCode, changed: Flag)
  where code is not a safe integer from 0 through 255
  then
    refuse INVALID_EXIT_CODE "A command exit code must be a safe integer from 0 through 255."
  where another exit status was already selected
  then
    refuse EXIT_SELECTED "This command invocation already has another exit status."
  where this status was already selected
  then
    return code, changed
  where no exit status was selected
  then
    retain and expose the process exit status without terminating the process
    return code, changed
```

## Queries

```queries
_invocation () : optional (words: Arguments)
  Returns no row before capture and a copy of the captured words afterward.

_outcome () : optional (code: ExitCode)
  Returns no row before an exit status is selected.
```
