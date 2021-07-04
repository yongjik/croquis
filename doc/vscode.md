# Using VS Code

I just started learning [VS code](https://code.visualstudio.com/), so this is a
compilation of random stuff I found: some of them may be useful.

## Javascript

Apparently, it seems impossible to run multiple debuggers (say, JS and Python)
in one VS code window at the same time: see
https://github.com/microsoft/vscode/issues/4507

So, I guess the best solution is to create two workspaces, one under `src/js`
and another for everything else.  Then you can open two VS code windows side by
side.

For style check, you can install ESLint extension - default `.eslintrc.js` is
provided.

For debugging, start a separate terminal, go to any directory containing your
notebook files, and run: `jupyter-notebook --no-browser`.  (`--no-browser` is
not necessary but it's cleaner that way.)  It will print something like:

```
$ jupyter-notebook --no-browser
......
    To access the notebook, open this file in a browser:
        file:///......
    Or copy and paste one of these URLs:
        http://localhost:8888/?token=5a279ac7f6b052b30a9905d665d8a36542218501d4e2c3f3
     or http://127.0.0.1:8888/?token=5a279ac7f6b052b30a9905d665d8a36542218501d4e2c3f3
```

Inside VS code, choose "Start Debugging", choose "Chrome", and it will start a
new instance of Chrome connected to the IDE.

Inside VS Code, add the following `pathMapping` to `launch.json`, and restart
debugging so that the change takes effect:

```
    "configurations": [
        {
            "type": "pwa-chrome",
            "request": "launch",
            "name": "Launch Chrome against localhost",
            ......
            "pathMapping": {
                "/nbextensions/croquis_fe_dev.js": "${workspaceFolder}/croquis_fe.js"
            }
        }
    ]
```

Now open the Notebook URL inside the debug Chrome.

## Python

VS code can attach to a running process.  First launch Jupyter notebook, run `ps
-ef | grep ipykernel` to find out the process ID, and inside VS code, choose
"Start Debugging" and then "Attach using Process ID".  Add a breakpoint, execute
a Jupyter cell in the browser, and the breakpoint will trigger.

Inside `launch.json`, add `"justMyCode": false` so that you can see the full
stack trace including Jupyter internals.

For some reason, I found that "Go to Symbol in Workspace" is pretty unreliable -
it started working only after I disabled pylance extension.  YMMV.

## C++

(TODO)
