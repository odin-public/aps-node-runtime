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
%install
cd $RPM_BUILD_ROOT
mkdir -p .HOME_DIR
cp -r $RPM_BUILD_DIR/src/. .HOME_DIR
chmod -R 0755 .HOME_DIR
mkdir -p 0755 .CONFIG_DIR
cp $RPM_BUILD_DIR/CONFIG_NAME .CONFIG_DIR
chmod -R 0755 .CONFIG_DIR
mkdir -p -m 0755 .ENDPOINT_DIR
mkdir -p -m 0755 .LOG_DIR
%clean
%pre
type node || { echo >&2 "Unable to find NodeJS. Make sure 'node' binary is in PATH ($PATH)!"; exit 1; }
echo NodeJS version: `node -v`. Developed for: NODE_MIN.
%post
adduser -r IDENTITY || echo >&2 "Unable to add user! Please add the user manually via: 'adduser -r IDENTITY'";
%postun
userdel -f IDENTITY
%files
%defattr(755,root,root,755)
%config(noreplace) "CONFIG_DIR/CONFIG_NAME"
%dir "CONFIG_DIR"
