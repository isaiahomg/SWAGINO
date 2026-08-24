' Runs the given command line with no visible console window.
' Each argument passed to this script is re-quoted and joined, so callers
' don't have to fight cmd.exe's quoting rules for paths containing spaces.
Dim sh, cmd, i
Set sh = CreateObject("WScript.Shell")
cmd = ""
For i = 0 To WScript.Arguments.Count - 1
  cmd = cmd & " """ & WScript.Arguments(i) & """"
Next
sh.Run Trim(cmd), 0, False
