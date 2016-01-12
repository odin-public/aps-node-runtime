# aps-node-runtime
APS Endpoint Runtime implementation in Node.js

This repository uses **git flow** with the following config:

```
[gitflow "branch"]
  master = master
  develop = dev
[gitflow "prefix"]
  feature = feature/
  release = release/
  hotfix = hotfix/
  versiontag = 
  support = support/
```

## How do I test it?

You will need NodeJS for all activities. To quickly install it, you can use these commands:

    wget https://nodejs.org/dist/v5.4.0/node-v5.4.0-linux-x64.tar.gz && tar xvf node-v5.4.0-linux-x64.tar.gz && cd node-v5.4.0-linux-x64 && cp -r */ /usr && cd ..

This will install `node` along with `npm` with `/usr` prefix. Use `node -v` and `npm -v` to check.

Currently, about **80%** of insfrastructure and routing is completed. However, only about **5%** of user code API and APS functionality is done. If you want to go ahead and test what's working, follow the steps below, and remember, **contributions are welcome in all forms (issues, pull requests, etc.)**.

You need a working OA 6.0 installation with APS. Download the latest RPM from [releases section](../../releases) or [build it yourself](#building-rpm-from-source).

Use your RPM to install the runtime on the endpoint host (it needs to have **NodeJS of version 5 and above** already installed and available in `PATH`):

    yum install aps-node-runtime-version.rpm

Pay attention to what the terminal says during installation. The output will contain instructions on **how to generate TLS credentials for your runtime**. What you just installed consists of these parts:

```
/usr/sbin/aps-node - control script
/usr/share/aps/node/ - home directory
/etc/aps/node - main and endpoints configuration directory, also holds main TLS credentials
/var/aps-node - default endpoint home directory (note that endpoints may be installed anywhere), holds user code and instance and endpoint logs
/var/log/aps-node.log - main daemon log
```

You can control the runtime daemon with these commands:

```
aps-node start
aps-node stop
aps-node restart
```

If you try to start the daemon (**control script needs to be run as root**), it will display something like this (assuming you have generated the TLS credentials correctly, see above):

```
[root@endpoint ~]# aps-node start
Starting APS Node.js daemon... [ FAIL ]
Reason: Endpoints directory is empty. Nothing to do!
More information may be available in '/var/log/aps-node.log'.
```

It will generally tell you what's wrong if it doesn't start. You can check the mentioned log for more info. In this case, endpoint configuration directory is empty (we have not yet created any endpoints, you will learn how to do that below).

You can also check and adjust main daemon configuration file at `/etc/aps/node/config.json`.

When you fix all issues that prevent it from starting, you will see something similar to this:

```
[root@endpoint node]# aps-node start
Starting APS Node.js daemon... [  OK  ] PID: 851
0.0.0.0
└─┬ 443
  └─┬ (*)
    └── /test - 'c72'
More information may be available in '/var/log/aps-node.log'.
```

That output includes a PID of a newly started daemon as well as location of a main log file (also featured before) and a routing table for all active endpoints (it's a tree that has these levels `ip->port->virtualHost->name` and also includes the ID of each endpoint in single quotes). You can check that it's running:

```
[root@endpoint node]# ps auxf | grep 851
aps-node   851  1.6  0.6 1048000 55656 pts/0   Sl   11:24   0:01 /usr/bin/node daemon.js
```

Here it is, dropped its privileges and is now running as `aps-node`. Observant people may notice that it still has a terminal (`pts/0`) attached, whereas a daemon shouldn't need a terminal. Those observant people would be correct, and it's already known as [issue #7](../../issues/7) and I'd really appreciate any help if someone knows how to fix it. :smile:

That's it! You can now use this host the same way you did with PHP runtime. You can use [VPS Cloud Basic](http://dev.apsstandard.org/apps/2.0/APS%20team/Sample%20VPS%20Cloud%20Basic/APS%20team/) for testing the functionality (it has service named `clouds` out of the box).

## How do I create an endpoint?

In PHP runtime, that task was performed by `endpoint.sh` script. For this runtime, the task is not yet automated (althoug it will probably be performed by the same `aps-node` script in the future).

Currently, an endpoint is created manually. An endpoint is defined by two assets:

- Configuration file in JSON format
- Home directory that contains user code

Minimal configuration file looks like this:

test.json
```
{
  "services": [
    "clouds"
  ]
}
```

Placing this file inside the endpoints configuration directory at `/etc/aps/node/endpoints` will create an endpoint with name `test` (deduced from file name), home inside default directory (full path: `/var/aps/node/test`) and all other default options. Upon starting, runtime will look for `clouds.js` inside the home directory to handle the incoming requests for service with ID `clouds`.

If something goes wrong, you can always check the main log or the endpoint log (`aps/endpoint.log` inside the endpoint gome directory).

The runtime drops privileges after starting and all credentials are switched to `aps-node` (user and group). Make sure that all objects inside endpoint home directory (and the directory itself) are **readable, writable and executable for that user and group**.

More verbose configuration example:

```
{
  "host": "127.0.0.1",
  "port": 443,
  "virtualHost": "test.com",
  "name": "aac",
  "home": "folder+1",
  "services": {
    "aaa": true,
    "cloud": "globals.js",
    "aac": true,
    "clouv": ""
  },
  "useBabel": true,
  "logLevel": "trace",
  "dummy": false
}
```

Full docs about this configuration are coming later™. :grinning:

You will need to create and place service code files in the endpoint home directory. You will learn how to do that below.

When starting, endpoint will create `aps` directory (which contains a log and a type cache that is useless for now). When endpoint receives requests for instance creation, `aps` directory will be filling with folders named as IDs (GUIDs) of the newly created instances. These directoriess will contain all the instance assets (instance's own TLS credentials as well as controller's certificate, instance configuration JSON file and instance log).

## Service code files

Service code files are located inside (sometimes not immideately) the endpoint home directory. If everything else goes well, this file is ultimately the one deciding what to do with the request. **Service handlers are ES6 (ES2015) compatible**, by default, `babel` will be used to transpile the file, unless `useBabel` is set to `false` for that endpoint. A typical file looks like this:

```javascript
import crypto from 'crypto';
import util from 'util';

// this scope runs during a dry run and on each request

export default class globals {
  constructor() {
    // this scope runs on each request when resource is being constructed ('this' refers to the resource)
  }

  provision() {
  
    //these scopes run on each time a corresponding operation is performed on the resource

    aps.logger.info(util.inspect(this));
    this.apphost = new Date();
    return new Promise(resolve => {
      setTimeout(resolve, 1000);
    });
  }

  configure(newResource) {
    this.cloudpass = 'testtest';
  }

  unprovision() {
    aps.logger.info('HELP! They are deleting me!!!1');
    return new Promise(resolve => {
      setTimeout(resolve, 1000);
    });
  }
}
```

You are encouraged to experiment with the service code files to see what they are capable of. Notable features:

- Global object is shared between all service code scopes of the same instance and is not dropped while the runtime is running (use it to share DB connections or something like that).
- Global scope contains `aps` object that will hold the user code API (**note: when it's undefined, that means that runtime is executing a so-called 'dry run', it does that once for each service after starting**).
- Returning `Promise` (or any `.then`able) from functions will use its value to decide the request's fate.
- `aps.logger` allows you to write to the corresponding `instance.log`.
- `this` is set to the resource in question (**note: no validation is performed on `this` before `JSON.stringify`ing it and sending to the controller**).
- `require` works properly (uses correct paths), but `process.cwd` does not. This means that running something like `fs.readFile('./test.txt')` will actually attempt to read `/usr/share/aps/node/test.txt` instead of a file inside the endpoint home.

Keep in mind that you need to **restart the main daemon after changing code** because that runtime is persistent and reads all its files only once when starting. The only handles it keeps when running are logs and sockets.

## Interpreting logs

This runtime has a very verbose logging. Adjust log levels in corresponding configs if you have to.

```
2016-01-11 10:41:28.310 [WARNING][E:c8c] Dummy mode set to: false (default, key: 'dummy' not found)
2016-01-11 10:41:28.310 [INFO][E:c8c] Initialized successfully! Key: '(*)0.0.0.0:443/test'.
2016-01-11 10:41:28.311 [DEBUG][Router] Endpoint host identifier is already an IP address: '0.0.0.0'. No NS lookup needed!
```

Log messages typically contain date and time, message level, a prefix or several (sometimes with an ID) and the message itself. Most dynamic values will be enclosed in `'` if they are strings.

Prefixes help you identify what sent that log message. Prefixes can contain IDs (like endpoint or instance IDs) as well. Those that do are shown here:

```
E: endpoint
I: instance
R: request
```

Each log message has a level. The message only gets printed if the destination logger's log level is lower or equal to that of a message:

```
TRACE - typically used to log dynamic data (file contents, etc.)
DEBUG - emitted when small part of bigger action completes
INFO - more general messages, configuration value changes
WARNING - minor unexpected condition occurred
ERROR - component failure occurred, daemon continues its operation
CRITICAL - emitted only by daemon itself when fatal error occurred, daemon stops
```

As a rule of thumb, **whenever you see a stack trace in a log or somewhere else, a code change will be required to fix it**. It may be a change in runtime code or a service handlers. If no stack trace is found, most likely the problem lies within configuration or other input data.

Good luck! :grinning:

## Building RPM from source

You will need:

- Centos >= 6
- NodeJS >= 5
- NPM that comes with it
- Babel 5.8.34
- `rpmbuild` command

If you are missing something from this list (exctept the first item :grinning:), `build/build.sh` script will tell you about it.

Steps:

- Download the [latest source ZIP](../../archive/dev.zip).
- `unzip dev.zip`
- `cd aps-node-runtime-dev/build`
- `chmod +x build.sh`
- `./build.sh`
- If you want to prevent cleanup after build process (e.g. to examine individual stages), run `./build.sh debug`

This will download all the necessary packages and make an RPM inisde the `build` directory. Use that RPM to install the runtime on your OA endpoint.

## Frequently asked questions

##### Q:

Why is your RPM so huge (3.25 MB)?

##### A: 

It contains all `npm` dependencies for the runtime so you don't have to download them after installation (since their version is supposed to be frozen anyway). It includes some fat packages like `babel`.

##### Q:

Why doesn't feature X work? It works fine in PHP runtime!

##### A: 

This is a prototype. There is only so much you can do with limited development time that is interrupted by ticket processing. **Fix/create something yourself and submit that pull request, buddy.** :grinning: Or at least head over to [issues section](../../issues) and tell us what doesn't work (**don't forget to include complete information on how to reproduce the issue**).

##### Q:

An error has occured in one of my service scripts, but it's stack trace does not match the code I wrote. What's the deal here?

##### Q:

I've installed your runtime and then went to `/usr/share/aps/node` to check the JS sources out. The code I saw there is not readable at all. How did you write this? Are you insane?

##### A: 

I'm not insane... no, really. :laughing: However, the people behind [Babel transpiler](https://babeljs.io/) ARE insane (and by that I mean insanely smart). This runtime uses Babel extensively to transform code from ES6 to ES5 both inside itself and inside user scripts. If you want to check out code, do it on this repository and not on the already-installed runtime. If you see a discrepancy in stack traces, that means that source map support failed somewhere and you can submit a bug.
