import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { Project, Generation } from '../types';

interface AppState {
  // Current project
  currentProject: Project | null;

  // Image display state
  currentImage: string | null;
  allImages: string[];

  // Upload state
  uploadedImages: string[];

  // Generation state
  isGenerating: boolean;
  currentPrompt: string;
  temperature: number;
  resolution: string;
  scenarioCount: number;

  // History and variants
  selectedGenerationId: string | null;
  showHistory: boolean;

  // Panel visibility
  showPromptPanel: boolean;

  // Actions
  setCurrentProject: (project: Project | null) => void;
  setCurrentImage: (url: string | null) => void;
  setAllImages: (urls: string[]) => void;

  addUploadedImage: (url: string) => void;
  removeUploadedImage: (index: number) => void;
  clearUploadedImages: () => void;

  setCurrentPrompt: (prompt: string) => void;
  setTemperature: (temp: number) => void;
  setResolution: (res: string) => void;
  setScenarioCount: (count: number) => void;
  setIsGenerating: (generating: boolean) => void;

  selectGeneration: (id: string | null) => void;
  setShowHistory: (show: boolean) => void;
  setShowPromptPanel: (show: boolean) => void;

  addGeneration: (generation: Generation) => void;
  setCurrentProject: (project: Project | null) => void;
}

export const useAppStore = create<AppState>()(
  devtools(
    (set, get) => ({
      // Initial state
      currentProject: null,
      currentImage: null,
      allImages: [],
      uploadedImages: [],
      isGenerating: false,
      currentPrompt: '',
      temperature: 1.0,
      resolution: '4K',
      scenarioCount: 1,
      selectedGenerationId: null,
      showHistory: true,
      showPromptPanel: true,

      // Actions
      setCurrentProject: (project) => set({ currentProject: project }),
      setCurrentImage: (url) => set({ currentImage: url }),
      setAllImages: (urls) => set({ allImages: urls }),

      addUploadedImage: (url) => set((state) => ({
        uploadedImages: [...state.uploadedImages, url]
      })),
      removeUploadedImage: (index) => set((state) => ({
        uploadedImages: state.uploadedImages.filter((_, i) => i !== index)
      })),
      clearUploadedImages: () => set({ uploadedImages: [] }),

      setCurrentPrompt: (prompt) => set({ currentPrompt: prompt }),
      setTemperature: (temp) => set({ temperature: temp }),
      setResolution: (res) => set({ resolution: res }),
      setScenarioCount: (count) => set({ scenarioCount: count }),
      setIsGenerating: (generating) => set({ isGenerating: generating }),

      selectGeneration: (id) => set({ selectedGenerationId: id }),
      setShowHistory: (show) => set({ showHistory: show }),
      setShowPromptPanel: (show) => set({ showPromptPanel: show }),

      addGeneration: (generation) => set((state) => {
        if (!state.currentProject) {
          const newProject: Project = {
            id: Date.now().toString(),
            name: 'New Project',
            generations: [generation],
            edits: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          return { currentProject: newProject };
        }

        return {
          currentProject: {
            ...state.currentProject,
            generations: [...state.currentProject.generations, generation],
            updatedAt: Date.now(),
          },
        };
      }),
    }),
    { name: 'nano-banana-store' }
  )
);