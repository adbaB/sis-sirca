#!/bin/bash
cd $(dirname $0)

export PATH="/home/ubuntu/.nvm/versions/node/v24.12.0/bin:$PATH"

node bcv-scraper.js