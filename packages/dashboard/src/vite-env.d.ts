/// <reference types="vite/client" />

declare module 'virtual:skillsmap-config' {
  import { SkillNode } from '@skillsmap/core';
  const config: {
    skills: SkillNode[];
  };
  export default config;
}
