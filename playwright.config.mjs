import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',fullyParallel:true,retries:1,timeout:35000,
  reporter:[['list'],['html',{open:'never'}]],
  use:{baseURL:'http://127.0.0.1:4173',trace:'retain-on-failure',screenshot:'only-on-failure'},
  projects:[
    {name:'desktop-chromium',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900}}},
    {name:'mobile-chromium',use:{...devices['iPhone 13'],browserName:'chromium'}},
    {name:'small-mobile',use:{...devices['iPhone SE'],browserName:'chromium'}}
  ],
  webServer:{
    command:'python3 -m http.server 4173 --bind 127.0.0.1',
    url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI,timeout:20000
  },
  outputDir:'test-results'
});
