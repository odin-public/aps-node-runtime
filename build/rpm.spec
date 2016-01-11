Name: PACKAGE_NAME
Vendor: Odin, Inc.
Version: PACKAGE_VERSION
Release: PACKAGE_RELEASE
Summary: APS Node.js endpoint runtime
URL: PROJECT_URL
License: MIT
Group: Server Software
BuildArch: noarch
BuildRoot: %{_tmppath}/%{name}-buildroot
%description
This package contains an application backend that is used with APS: https://dev.apsstandard.org/
%prep
tar xvf $RPM_SOURCE_DIR/PACKAGE_NAME.tgz
cp $RPM_SOURCE_DIR/CONFIG_NAME .
cp $RPM_SOURCE_DIR/CONTROL_SCRIPT_NAME .
%install
cd $RPM_BUILD_ROOT
mkdir -p .HOME_DIR
cp -r $RPM_BUILD_DIR/src/. .HOME_DIR
chmod -R 0755 .HOME_DIR
mkdir -p .CONFIG_DIR
cp $RPM_BUILD_DIR/CONFIG_NAME .CONFIG_DIR
mkdir .CONFIG_DIR/ENDPOINT_CONFIG_SUBDIR
chmod -R 0700 .CONFIG_DIR
mkdir -p -m 0755 .ENDPOINT_DIR
mkdir -p -m 0755 .LOG_DIR
mkdir -p -m 0755 .BIN_DIR
cp $RPM_BUILD_DIR/CONTROL_SCRIPT_NAME .BIN_DIR
chmod +x .BIN_DIR/CONTROL_SCRIPT_NAME
%clean
%pre
type node || { echo >&2 "Unable to find NodeJS. Make sure 'node' binary is in PATH ($PATH)!"; exit 1; }
echo NodeJS version: `node -v`. Developed for: NODE_MIN.
adduser -r IDENTITY || echo >&2 "Unable to add user! Please add the user manually via: 'adduser -r IDENTITY'";
cat <<MSG
To generate keys (in CONFIG_DIR):

cd CONFIG_DIR
HOSTNAME=\`hostname\`
openssl genrsa -out daemon.key
openssl req -x509 -new -nodes -key daemon.key -subj "/DC=APS/DC=Application Endpoint/O=\$HOSTNAME/OU=APS/CN=\$HOSTNAME" -out daemon.crt
chmod 0600 daemon.{crt,key}

MSG
%post
%preun
userdel -f IDENTITY || echo >&2 "Unable to remove user 'IDENTITY'!";
%postun
%files
%defattr(755,root,root,755)
"BIN_DIR/CONTROL_SCRIPT_NAME"
%config(noreplace) %attr(600, root, root) "CONFIG_DIR/CONFIG_NAME"
%dir %attr(700, root, root) "CONFIG_DIR"
%dir %attr(700, root, root) "CONFIG_DIR/ENDPOINT_CONFIG_SUBDIR"
%dir %attr(700, IDENTITY, IDENTITY) "ENDPOINT_DIR"
