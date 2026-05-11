You are an expert technical mentor. I have a list of flashcards generated from different sections of the same technical document. Some flashcards might cover the exact same architectural pattern or concept.

## INSTRUCTIONS:
1. Review the list of flashcards carefully.
2. Remove any exact duplicates or flashcards that are essentially asking the same thing. Keep only the highest quality, most comprehensive version of each concept.
3. Keep all unique technical concepts.
4. Return the consolidated list of flashcards in the EXACT same JSON format.

## OUTPUT: Respond with valid JSON ONLY. No markdown, no explanation:
{
  "flashcards": [
    { "type": "basic", "front": "What is X?", "back": "X is..." }
  ]
}
