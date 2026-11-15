import os
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings

def ingest_all_files():
    papers_dir = "papers"
    
    if not os.path.exists(papers_dir):
        print(f"Directory '{papers_dir}' not found.")
        return

    docs = []
    print("Scanning papers directory and subfolders...")

    for root, dirs, files in os.walk(papers_dir):
        for file in files:
            file_path = os.path.join(root, file)
            
            if file.startswith('.'):
                continue
                
            try:
                if file.endswith(".pdf"):
                    loader = PyPDFLoader(file_path)
                    docs.extend(loader.load())
                    print(f"Loaded PDF: {file}")
                elif file.endswith((".txt", ".md", ".json")):
                    loader = TextLoader(file_path, encoding="utf-8", autodetect_encoding=True)
                    docs.extend(loader.load())
                    print(f"Loaded Text/Metadata: {file}")
            except Exception as e:
                print(f"Skipping unparseable file {file_path}: {e}")

    if not docs:
        print("No valid documents found for ingestion.")
        return

    print(f"\nTotal raw document pages/files loaded: {len(docs)}")

    # Split into clean chunks for RAG
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
        length_function=len,
    )
    splits = text_splitter.split_documents(docs)
    print(f"Generated {len(splits)} total text chunks.")

    # Initialize embedding model and upsert into ChromaDB
    embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
    
    # Clear old vector database to ensure a clean slate
    if os.path.exists("chroma_db"):
        import shutil
        shutil.rmtree("chroma_db")
        print("Cleared old ChromaDB index.")

    print("Embedding and storing chunks into ChromaDB (collection: 'langchain')...")
    vectorstore = Chroma.from_documents(
        documents=splits,
        embedding=embeddings,
        persist_directory="chroma_db",
        collection_name="langchain"
    )
    
    print("\nIngestion complete! All investigation text files and PDFs successfully indexed.")

if __name__ == "__main__":
    ingest_all_files()