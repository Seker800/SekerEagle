/** Non-shared domains. Shared library models belong to library-capabilities.ts only. */
export const PERSISTED_MODEL_OWNERS = [
  { id: 'authentication', tables: ['User', 'RefreshToken', 'PersonalAccessToken'] },
  { id: 'deployment', tables: ['AppDeploymentIdentity'] },
  {
    id: 'photography',
    tables: [
      'EaglePhotoMetadata',
      'EaglePhotoGroup',
      'EaglePhotoGroupMember',
      'EaglePhotoLocation',
    ],
  },
  { id: 'people', tables: ['EaglePhotoPerson', 'EaglePhotoFace', 'EaglePhotoPersonSeparation'] },
  {
    id: 'photo-agent',
    tables: [
      'EaglePhotoAgentPreference',
      'EaglePhotoAgentTask',
      'EaglePhotoAgentEvent',
      'EaglePhotoAgentSuggestion',
    ],
  },
  {
    id: 'photo-map',
    tables: [
      'EaglePhotoMapState',
      'EaglePhotoMapSnapshot',
      'EaglePhotoMapPoint',
      'EaglePhotoMapCell',
    ],
  },
] as const;
