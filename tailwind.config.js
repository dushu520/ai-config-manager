/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        'bg-primary': '#0D1117',
        'bg-secondary': '#161B22',
        'bg-tertiary': '#21262D',
        'accent': '#58A6FF',
        'success': '#3FB950',
        'warning': '#D29922',
        'text-primary': '#E6EDF3',
        'text-secondary': '#8B949E',
        'border': '#30363D',
      },
    },
  },
}
