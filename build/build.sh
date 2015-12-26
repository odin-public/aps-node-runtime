#!/bin/sh

type npm >/dev/null 2>&1 || { echo >&2 "Unable to find 'npm'. Exiting"; exit 1; }
type node >/dev/null 2>&1 || { echo >&2 "Unable to find 'node'. Exiting"; exit 1; }
type babel >/dev/null 2>&1 || { echo >&2 "Unable to find 'babel' (npm -g i babel). Exiting"; exit 1; }
type rpmbuild >/dev/null 2>&1 || { echo >&2 "Unable to find 'rpmbuild'. Exiting"; exit 1; }

PACKAGE_NAME=aps-node-runtime
PACKAGE_VERSION=`node config.js VERSION`
PACKAGE_RELEASE=1
PROJECT_URL=https://github.com/oa-platform/aps-node-runtime
NODE_MIN_VERSION=`node config.js NODE_MIN_VERSION`
BABEL_VERSION=`node config.js BABEL_VERSION`
BLUEBIRD_VERSION=`node config.js BLUEBIRD_VERSION`
MOMENT_VERSION=`node config.js MOMENT_VERSION`
UTILIS_VERSION=`node config.js UTILIS_VERSION`
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
babel _src --out-dir _babel || exit 1
cp -r _babel/. src
#end of removal
#cp -r _src/. src
cd src
npm i babel@$BABEL_VERSION bluebird@$BLUEBIRD_VERSION moment@$MOMENT_VERSION core-util-is@$UTILIS_VERSION || exit 1
cd ..
sed "s|PACKAGE_NAME|$PACKAGE_NAME|; s|PACKAGE_VERSION|$PACKAGE_VERSION|; s|PACKAGE_RELEASE|$PACKAGE_RELEASE|; s|PROJECT_URL|$PROJECT_URL|; s|CONFIG_NAME|$CONFIG_NAME|; s|NODE_MIN|v${NODE_MIN_VERSION}|; s|HOME_DIR|$HOME_DIR|; s|CONFIG_DIR|$CONFIG_DIR|; s|ENDPOINT_DIR|$ENDPOINT_DIR|; s|LOG_DIR|$LOG_DIR|; s|IDENTITY|$IDENTITY|g" rpm.spec > _rpm.spec
find src -type d -printf "%%dir \"$HOME_DIR/%P\"\n" >> _rpm.spec
find src \( -type l -o -type f \) -printf "\"$HOME_DIR/%P\"\n" >> _rpm.spec
tar -cvzf $PACKAGE_NAME.tgz src
mkdir -p _rpm/{BUILD,RPMS,SOURCES,SPECS,SRPMS}
cd _rpm
mv ../$PACKAGE_NAME.tgz SOURCES
node ../config.js MAIN_CONFIG > SOURCES/$CONFIG_NAME
\cp -f ~/.rpmmacros{,.bck} >/dev/null 2>&1
cat > ~/.rpmmacros <<- EOM
%packager Paul Gear
%_topdir `pwd`
%_tmppath `pwd`/tmp
EOM
cp -f ../_rpm.spec SPECS/rpm.spec
rpmbuild -ba SPECS/rpm.spec || { echo >&2 "Unable to build the RPM"; exit 1; }
cp RPMS/noarch/* ../

[ "$1" = "debug" ] && exit
popd
rm -rf $PACKAGE_NAME src _src _babel _rpm _rpm.spec >/dev/null 2>&1
