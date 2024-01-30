#!/bin/bash

version=$1

# Update package.json in the project root
npm --prefix ./ version --no-git-tag $version

# Update package.json in the client subdirectory
npm --prefix ./client version --no-git-tag $version

# Update package.json in the server subdirectory
npm --prefix ./server version --no-git-tag $version

# Run the genversion npm script to update the version number exposed to the project source code
npm run genversion
