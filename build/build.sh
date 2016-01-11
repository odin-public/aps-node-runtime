#!/bin/sh

type npm >/dev/null 2>&1 || { echo >&2 "Unable to find 'npm'. Exiting"; exit 1; }
type node >/dev/null 2>&1 || { echo >&2 "Unable to find 'node'. Exiting"; exit 1; }
type babel >/dev/null 2>&1 || { echo >&2 "Unable to find 'babel' (npm -g i babel@5.8.34). Exiting"; exit 1; }
type rpmbuild >/dev/null 2>&1 || { echo >&2 "Unable to find 'rpmbuild' (yum install rpm-build). Exiting"; exit 1; }

PACKAGE_NAME=aps-node-runtime
PACKAGE_VERSION=`node config.js VERSION`
PACKAGE_RELEASE=1
PROJECT_URL=https://github.com/oa-platform/aps-node-runtime
CONTROL_SCRIPT_NAME=aps-node
ENDPOINT_CONFIG_SUBDIR=endpoints
BIN_DIR=/usr/sbin
NODE_MIN_VERSION=`node config.js NODE_MIN_VERSION`
BABEL_VERSION=`node config.js BABEL_VERSION`
BLUEBIRD_VERSION=`node config.js BLUEBIRD_VERSION`
MOMENT_VERSION=`node config.js MOMENT_VERSION`
UTILIS_VERSION=`node config.js UTILIS_VERSION`
SOURCEMAP_VERSION=`node config.js SOURCEMAP_VERSION`
HOME_DIR=`node config.js HOME_DIR`
CONFIG_DIR=`node config.js CONFIG_DIR`
CONFIG_NAME=config.json
ENDPOINT_DIR=`node config.js ENDPOINT_DIR`
LOG_DIR=`node config.js LOG_DIR`
IDENTITY=`node config.js IDENTITY`

pushd .

rm -rf $PACKAGE_NAME src _src _babel _rpm _rpm.spec >/dev/null 2>&1
mkdir _src
cp -r ../src/. _src
node config.js > _src/util/constants.js
#remove if no babel needed
npm list babel-plugin-source-map-support > /dev/null 2>&1 || npm i babel-plugin-source-map-support
babel --source-maps inline --plugins source-map-support _src --out-dir _babel || exit 1
rm -rf node_modules
cp -r _babel/. src
#end of removal
#cp -r _src/. src
cd src
npm i babel@$BABEL_VERSION bluebird@$BLUEBIRD_VERSION moment@$MOMENT_VERSION core-util-is@$UTILIS_VERSION source-map-support@$SOURCEMAP_VERSION || exit 1
cd ..
sed "s|PACKAGE_NAME|$PACKAGE_NAME|g; s|PACKAGE_VERSION|$PACKAGE_VERSION|g; s|PACKAGE_RELEASE|$PACKAGE_RELEASE|g; s|PROJECT_URL|$PROJECT_URL|g; s|CONFIG_NAME|$CONFIG_NAME|g; s|NODE_MIN|v${NODE_MIN_VERSION}|g; s|HOME_DIR|$HOME_DIR|g; s|CONFIG_DIR|$CONFIG_DIR|g; s|ENDPOINT_CONFIG_SUBDIR|$ENDPOINT_CONFIG_SUBDIR|g;s|ENDPOINT_DIR|$ENDPOINT_DIR|g; s|LOG_DIR|$LOG_DIR|g; s|IDENTITY|$IDENTITY|g; s|BIN_DIR|$BIN_DIR|g; s|CONTROL_SCRIPT_NAME|$CONTROL_SCRIPT_NAME|g" rpm.spec > _rpm.spec
find src -type d -printf "%%dir \"$HOME_DIR/%P\"\n" >> _rpm.spec
find src \( -type l -o -type f \) -printf "\"$HOME_DIR/%P\"\n" >> _rpm.spec
sed "s|HOME_DIR|$HOME_DIR|g" aps-node > _aps-node
tar -cvzf $PACKAGE_NAME.tgz src
mkdir -p _rpm/{BUILD,RPMS,SOURCES,SPECS,SRPMS}
cd _rpm
mv ../$PACKAGE_NAME.tgz SOURCES
node ../config.js MAIN_CONFIG > SOURCES/$CONFIG_NAME
\cp -f ../_aps-node SOURCES/$CONTROL_SCRIPT_NAME
\cp -f ~/.rpmmacros{,.bck} >/dev/null 2>&1
cat > ~/.rpmmacros <<- EOM
%packager Paul Gear
%_topdir `pwd`
%_tmppath `pwd`/tmp
EOM
\cp -f ../_rpm.spec SPECS/rpm.spec
rpmbuild -ba SPECS/rpm.spec || { echo >&2 "Unable to build the RPM"; exit 1; }
cp RPMS/noarch/* ../

[ "$1" = "debug" ] && exit
popd
rm -rf $PACKAGE_NAME src _src _babel _rpm _rpm.spec _aps-node >/dev/null 2>&1
