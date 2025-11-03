# Todo Manager

A simple, elegant web-based task management application that helps you organize your todos efficiently.

## Features

- ✅ **Create Tasks**: Add new tasks with custom status
- ✏️ **Edit Tasks**: Modify task text and status anytime
- 🗑️ **Delete Tasks**: Remove completed or unwanted tasks
- 🔄 **Status Management**: Track tasks with four status levels:
  - Not Started
  - In Progress
  - On Hold
  - Done
- 🔗 **Link Support**: Include URLs in your tasks that automatically become clickable links
- 💾 **Local Storage**: All tasks are saved locally in your browser
- 🎨 **Clean UI**: Modern, responsive design that works on all devices
- 🔍 **Filter Tasks**: View all tasks or filter by specific status

## How to Use

1. **Open the Application**: Simply open `index.html` in your web browser
2. **Add a Task**: 
   - Type your task in the input field
   - Select a status from the dropdown
   - Click "Add Task" or press Enter
3. **Edit a Task**: Click the "Edit" button, modify the text or status, then click "Save"
4. **Delete a Task**: Click the "Delete" button and confirm
5. **Filter Tasks**: Use the filter buttons to view tasks by status

## Running Locally

### Option 1: Direct File Access
Simply open `index.html` in your web browser by double-clicking it.

### Option 2: Using a Local Server
For better compatibility, you can run a local web server:

```bash
# Using Python 3
python3 -m http.server 8080

# Then open http://localhost:8080 in your browser
```

## Technical Details

- Pure HTML, CSS, and JavaScript - no dependencies required
- Uses browser's localStorage API for data persistence
- Responsive design that adapts to different screen sizes
- Automatically converts URLs in task text to clickable links

## Browser Support

Works on all modern browsers that support:
- ES6 JavaScript
- localStorage API
- CSS Grid and Flexbox

## License

This project is open source and available for personal and commercial use.
