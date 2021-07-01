# Using VS Code

I just started learning ![VS code](https://code.visualstudio.com/), so this is a
compilation of random stuff I found: some of them may be useful.

## Javascript

## Python

VS code can attach to a running process.  Launch Jupyter notebook in the normal
way, run `ps -ef | grep ipykernel` to find out the process ID, and inside VS
code select "Python: Attach using Process ID".  Add a breakpoint, execute a
Jupyter cell in the browser, and the breakpoint will trigger.

Inside `launch.json`, add `"justMyCode": false` so that you can see the full
stack trace including Jupyter internals.

## C++
